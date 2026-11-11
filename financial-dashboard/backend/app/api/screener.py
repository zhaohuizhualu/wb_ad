"""
股票筛选 API（实时全市场版）

从东方财富 RPT_LICO_FN_CPD 接口实时拉取全市场年度财务数据，
计算毛利率/净利率/营收同比的历年均值，筛选出满足条件的股票。

数据覆盖：
- A股：全市场实时拉取（~5000+只），使用线程池并行拉取多年数据
- 港股/美股：从本地数据库筛选（已收录的公司）
"""
import datetime
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional, List

import requests
from fastapi import APIRouter, Query
from loguru import logger

from app.core.database import SessionLocal
from app.models.models import Company, CoreMetric

router = APIRouter()

# 东方财富数据接口
EASTMONEY_DATA_URL = "https://datacenter.eastmoney.com/securities/api/data/v1/get"


def _create_session():
    s = requests.Session()
    s.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": "https://data.eastmoney.com/"
    })
    return s


def _fetch_a_share_annual_data(
    session: requests.Session,
    report_date: str,
    max_pages: int = 15,
) -> list:
    """拉取某一报告期所有 A 股年度财务数据（分页）。"""
    all_items = []
    for page in range(1, max_pages + 1):
        params = {
            "reportName": "RPT_LICO_FN_CPD",
            "columns": (
                "SECUCODE,SECURITY_NAME_ABBR,XSMLL,YSTZ,SJLTZ,"
                "TOTAL_OPERATE_INCOME,PARENT_NETPROFIT,SECURITY_TYPE"
            ),
            "filter": f"(REPORTDATE='{report_date}')",
            "pageNumber": page,
            "pageSize": 500,
            "sortColumns": "TOTAL_OPERATE_INCOME",
            "sortTypes": "-1",
            "source": "WEB",
            "client": "WEB",
        }
        try:
            resp = session.get(EASTMONEY_DATA_URL, params=params, timeout=20)
            if resp.status_code != 200:
                logger.warning("拉取 {} 第{}页失败: HTTP {}", report_date, page, resp.status_code)
                break
            data = resp.json()
            result = data.get("result")
            if not isinstance(result, dict):
                break
            items = result.get("data") or []
            if not items:
                break
            for item in items:
                if item.get("SECURITY_TYPE") == "A股":
                    all_items.append(item)
            if len(items) < 500:
                break
        except Exception as e:
            logger.error("拉取 {} 第{}页异常: {}", report_date, page, e)
            break
    return all_items


def _fetch_year_data(session, year):
    """拉取单年数据（用于线程池并行）。每个线程使用独立 session 避免线程安全问题。"""
    s = _create_session()
    report_date = f"{year}-12-31"
    logger.info("拉取 A 股 {} 年报数据...", year)
    items = _fetch_a_share_annual_data(s, report_date)
    logger.info("A 股 {} 年报: 获取 {} 条记录", year, len(items))
    return year, items


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
    """实时拉取 A 股全市场数据进行筛选（多线程并行）。"""
    # 使用线程池并行拉取各年数据，最多 4 个线程并发
    max_workers = min(4, len(years))
    year_items = {}

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_year = {
            executor.submit(_fetch_year_data, None, year): year
            for year in years
        }
        for future in as_completed(future_to_year):
            year = future_to_year[future]
            try:
                yr, items = future.result()
                year_items[yr] = items
            except Exception as e:
                logger.error("拉取 {} 年数据失败: {}", year, e)
                year_items[year] = []

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
