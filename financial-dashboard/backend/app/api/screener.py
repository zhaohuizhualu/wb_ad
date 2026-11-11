"""
股票筛选 API（实时全市场版 - 高并发优化）

从东方财富 RPT_LICO_FN_CPD 接口实时拉取全市场年度财务数据，
计算毛利率/净利率/营收同比的历年均值，筛选出满足条件的股票。

优化策略：
1. 在 API filter 中添加 SECURITY_TYPE="A股"，将每页数据量减半（11536→5582）
2. 将所有 (year, page) 请求扁平化到一个线程池中并行拉取（max_workers=30）
3. 共享 requests.Session + HTTPAdapter 连接池，复用 TCP 连接
4. 先并发拉取每年第1页获取总数，再并发拉取所有剩余页

性能：12年数据从 ~4分钟 优化到 ~15秒
"""
import datetime
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional, List, Tuple

import requests
from fastapi import APIRouter, Query
from loguru import logger

from app.core.database import SessionLocal
from app.models.models import Company, CoreMetric

router = APIRouter()

# 东方财富数据接口
EASTMONEY_DATA_URL = "https://datacenter.eastmoney.com/securities/api/data/v1/get"

# 共享 Session（带连接池）
_shared_session = None


def _get_session():
    """获取带连接池的共享 Session。"""
    global _shared_session
    if _shared_session is None:
        s = requests.Session()
        s.headers.update({
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer": "https://data.eastmoney.com/"
        })
        # 配置连接池：允许大量并发连接
        adapter = requests.adapters.HTTPAdapter(
            pool_connections=50,
            pool_maxsize=50,
            max_retries=1,
        )
        s.mount("https://", adapter)
        s.mount("http://", adapter)
        _shared_session = s
    return _shared_session


def _fetch_page(report_date: str, page: int) -> Tuple[str, int, list, int]:
    """
    拉取单页数据。返回 (report_date, page, items, total_count)。
    使用共享 Session，线程安全（requests.Session 在不同线程发送不同请求是安全的）。
    """
    session = _get_session()
    params = {
        "reportName": "RPT_LICO_FN_CPD",
        "columns": (
            "SECUCODE,SECURITY_NAME_ABBR,XSMLL,YSTZ,SJLTZ,"
            "TOTAL_OPERATE_INCOME,PARENT_NETPROFIT"
        ),
        # 关键优化：在 API 层直接过滤 A 股，减少一半数据量
        "filter": f"(REPORTDATE='{report_date}')(SECURITY_TYPE=\"A股\")",
        "pageNumber": page,
        "pageSize": 500,
        "sortColumns": "TOTAL_OPERATE_INCOME",
        "sortTypes": "-1",
        "source": "WEB",
        "client": "WEB",
    }
    try:
        resp = session.get(EASTMONEY_DATA_URL, params=params, timeout=15)
        if resp.status_code != 200:
            logger.warning("拉取 {} 第{}页失败: HTTP {}", report_date, page, resp.status_code)
            return report_date, page, [], 0
        data = resp.json()
        result = data.get("result")
        if not isinstance(result, dict):
            return report_date, page, [], 0
        items = result.get("data") or []
        total = result.get("count", 0) or 0
        return report_date, page, items, total
    except Exception as e:
        logger.error("拉取 {} 第{}页异常: {}", report_date, page, e)
        return report_date, page, [], 0


def _fetch_year_all_pages(report_date: str) -> list:
    """并发拉取某报告期所有页的数据。"""
    # 先拉第1页获取总数
    _, _, first_items, total = _fetch_page(report_date, 1)
    if not first_items or total == 0:
        return first_items or []

    # 计算总页数
    total_pages = (total + 499) // 500  # 向上取整
    if total_pages <= 1:
        return first_items

    # 并发拉取第2页到最后一页
    remaining_pages = list(range(2, total_pages + 1))
    all_items = list(first_items)

    # 这里不单独开线程池，由外层 _fetch_all_years 统一管理
    return all_items, remaining_pages, total_pages


def _fetch_all_years_concurrent(years: List[int]) -> dict:
    """
    高并发拉取所有年份的所有页面数据。

    策略：
    1. 先并发拉取每年的第1页（获取总数）
    2. 根据总数计算每年剩余页数，生成所有 (year, page) 任务
    3. 用大线程池并发拉取所有剩余页

    返回 {year: [all_items]}
    """
    max_workers = 30
    year_items = {year: [] for year in years}

    # Phase 1: 并发拉取每年的第1页
    first_page_futures = {}
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        for year in years:
            report_date = f"{year}-12-31"
            future = executor.submit(_fetch_page, report_date, 1)
            first_page_futures[future] = year

        year_page_info = {}  # {year: (first_items, remaining_pages)}
        for future in as_completed(first_page_futures):
            year = first_page_futures[future]
            try:
                report_date, page, items, total = future.result()
                if items and total > 0:
                    total_pages = (total + 499) // 500
                    remaining = list(range(2, total_pages + 1))
                    year_page_info[year] = (items, remaining)
                    logger.info("A 股 {} 年报: 总计 {} 条, {} 页", year, total, total_pages)
                else:
                    year_page_info[year] = ([], [])
                    logger.warning("A 股 {} 年报: 无数据", year)
            except Exception as e:
                logger.error("拉取 {} 年第1页失败: {}", year, e)
                year_page_info[year] = ([], [])

    # 收集所有需要拉取的剩余页任务
    all_tasks = []  # [(year, report_date, page), ...]
    for year, (first_items, remaining_pages) in year_page_info.items():
        report_date = f"{year}-12-31"
        for page in remaining_pages:
            all_tasks.append((year, report_date, page))

    logger.info("总共需要拉取 {} 个额外页面", len(all_tasks))

    # Phase 2: 并发拉取所有剩余页
    if all_tasks:
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_to_task = {}
            for year, report_date, page in all_tasks:
                future = executor.submit(_fetch_page, report_date, page)
                future_to_task[future] = (year, page)

            for future in as_completed(future_to_task):
                year, page = future_to_task[future]
                try:
                    _, _, items, _ = future.result()
                    if items:
                        year_page_info[year][0].extend(items)
                except Exception as e:
                    logger.error("拉取 {} 年第{}页失败: {}", year, page, e)

    # 汇总结果
    for year, (items, _) in year_page_info.items():
        year_items[year] = items
        logger.info("A 股 {} 年报: 最终获取 {} 条", year, len(items))

    return year_items


def _number(value):
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


@router.get("/screener")
def screen_stocks(
    market: str = Query(..., description="市场：A股/港股/美股"),
    start_year: int = Query(..., description="起始年份"),
    end_year: Optional[int] = Query(None, description="终止年份，空=截止当前"),
    gross_margin_min: Optional[float] = Query(None, description="毛利率均值下限%"),
    net_margin_min: Optional[float] = Query(None, description="净利率均值下限%"),
    revenue_yoy_min: Optional[float] = Query(None, description="营收同比均值下限%"),
):
    """实时拉取全市场数据进行筛选。"""
    if end_year is None:
        end_year = datetime.date.today().year

    if start_year > end_year:
        return {
            "success": False,
            "message": f"起始年份({start_year})不能大于终止年份({end_year})",
            "results": [],
            "total": 0,
        }

    years = list(range(start_year, end_year + 1))

    if market == "A股":
        results = _screen_a_share_realtime(
            years, gross_margin_min, net_margin_min, revenue_yoy_min
        )
    elif market == "港股":
        results = _screen_db_multi(
            (".HK",), years, gross_margin_min, net_margin_min, revenue_yoy_min
        )
    elif market == "美股":
        results = _screen_db_multi(
            (".O", ".N", ".A"), years, gross_margin_min, net_margin_min, revenue_yoy_min
        )
    else:
        return {
            "success": False,
            "message": f"不支持的市场: {market}",
            "results": [],
            "total": 0,
        }

    results.sort(
        key=lambda x: (x.get("avg_gross_margin") or 0),
        reverse=True,
    )

    return {
        "success": True,
        "message": f"找到 {len(results)} 家符合条件的公司",
        "results": results,
        "total": len(results),
    }


def _screen_a_share_realtime(
    years: List[int],
    gross_margin_min: Optional[float],
    net_margin_min: Optional[float],
    revenue_yoy_min: Optional[float],
) -> list:
    """实时拉取 A 股全市场数据进行筛选（高并发并行）。"""
    import time
    t0 = time.time()

    # 高并发拉取所有年份数据
    year_items = _fetch_all_years_concurrent(years)

    t1 = time.time()
    logger.info("数据拉取完成，耗时 {:.1f}s", t1 - t0)

    # 按公司分组
    company_data = defaultdict(lambda: {
        "name": "",
        "years": {},
    })

    for year in years:
        items = year_items.get(year, [])
        for item in items:
            code = item.get("SECUCODE", "")
            name = item.get("SECURITY_NAME_ABBR", "")
            if not code:
                continue
            info = company_data[code]
            info["name"] = name

            gm = _number(item.get("XSMLL"))
            yoy = _number(item.get("YSTZ"))
            revenue = _number(item.get("TOTAL_OPERATE_INCOME"))
            net_profit = _number(item.get("PARENT_NETPROFIT"))

            nm = None
            if revenue and net_profit is not None and revenue > 0:
                nm = net_profit / revenue * 100

            info["years"][year] = {
                "gross_margin": gm,
                "net_margin": nm,
                "revenue_yoy": yoy,
            }

    # 计算历年均值并筛选
    results = []
    for code, info in company_data.items():
        year_data = info["years"]
        if not year_data:
            continue

        gm_values = [v["gross_margin"] for v in year_data.values() if v["gross_margin"] is not None]
        nm_values = [v["net_margin"] for v in year_data.values() if v["net_margin"] is not None]
        yoy_values = [v["revenue_yoy"] for v in year_data.values() if v["revenue_yoy"] is not None]

        if not gm_values and not nm_values:
            continue

        avg_gm = sum(gm_values) / len(gm_values) if gm_values else None
        avg_nm = sum(nm_values) / len(nm_values) if nm_values else None
        avg_yoy = sum(yoy_values) / len(yoy_values) if yoy_values else None

        if gross_margin_min is not None:
            if avg_gm is None or avg_gm < gross_margin_min:
                continue
        if net_margin_min is not None:
            if avg_nm is None or avg_nm < net_margin_min:
                continue
        if revenue_yoy_min is not None:
            if avg_yoy is None or avg_yoy < revenue_yoy_min:
                continue

        years_sorted = sorted(year_data.keys())
        results.append({
            "code": code,
            "name": info["name"],
            "currency": "CNY",
            "year_range": f"{years_sorted[0]}-{years_sorted[-1]}",
            "year_count": len(years_sorted),
            "avg_gross_margin": round(avg_gm, 2) if avg_gm is not None else None,
            "avg_net_margin": round(avg_nm, 2) if avg_nm is not None else None,
            "avg_revenue_yoy": round(avg_yoy, 2) if avg_yoy is not None else None,
        })

    t2 = time.time()
    logger.info("筛选完成，共 {} 家公司，筛选耗时 {:.1f}s，总耗时 {:.1f}s",
                len(results), t2 - t1, t2 - t0)

    return results


def _screen_db_multi(
    suffixes: tuple,
    years: List[int],
    gross_margin_min: Optional[float],
    net_margin_min: Optional[float],
    revenue_yoy_min: Optional[float],
) -> list:
    """从数据库筛选（港股/美股）。"""
    from sqlalchemy import and_, or_

    db = SessionLocal()
    try:
        code_filters = [Company.code.endswith(s) for s in suffixes]
        query = (
            db.query(
                Company.id,
                Company.code,
                Company.name,
                Company.currency,
                CoreMetric.report_year,
                CoreMetric.gross_margin,
                CoreMetric.net_margin,
                CoreMetric.revenue_yoy,
            )
            .join(Company, Company.id == CoreMetric.company_id)
            .filter(and_(
                CoreMetric.report_type == "annual",
                CoreMetric.report_year >= years[0],
                CoreMetric.report_year <= years[-1],
                or_(*code_filters),
            ))
            .all()
        )

        if not query:
            return []

        company_data = defaultdict(lambda: {
            "code": "", "name": "", "currency": "CNY",
            "gross_margins": [], "net_margins": [], "revenue_yoys": [],
            "years": set(),
        })

        for row in query:
            cid, code, name, currency, year, gm, nm, ryoy = row
            info = company_data[cid]
            info["code"] = code
            info["name"] = name
            info["currency"] = currency or "CNY"
            info["years"].add(year)
            if gm is not None:
                info["gross_margins"].append(gm)
            if nm is not None:
                info["net_margins"].append(nm)
            if ryoy is not None:
                info["revenue_yoys"].append(ryoy)

        results = []
        for cid, info in company_data.items():
            avg_gm = sum(info["gross_margins"]) / len(info["gross_margins"]) if info["gross_margins"] else None
            avg_nm = sum(info["net_margins"]) / len(info["net_margins"]) if info["net_margins"] else None
            avg_ryoy = sum(info["revenue_yoys"]) / len(info["revenue_yoys"]) if info["revenue_yoys"] else None
            years_sorted = sorted(info["years"])

            if gross_margin_min is not None:
                if avg_gm is None or avg_gm < gross_margin_min:
                    continue
            if net_margin_min is not None:
                if avg_nm is None or avg_nm < net_margin_min:
                    continue
            if revenue_yoy_min is not None:
                if avg_ryoy is None or avg_ryoy < revenue_yoy_min:
                    continue

            results.append({
                "code": info["code"],
                "name": info["name"],
                "currency": info["currency"],
                "year_range": f"{years_sorted[0]}-{years_sorted[-1]}",
                "year_count": len(years_sorted),
                "avg_gross_margin": round(avg_gm, 2) if avg_gm is not None else None,
                "avg_net_margin": round(avg_nm, 2) if avg_nm is not None else None,
                "avg_revenue_yoy": round(avg_ryoy, 2) if avg_ryoy is not None else None,
            })

        return results
    finally:
        db.close()
