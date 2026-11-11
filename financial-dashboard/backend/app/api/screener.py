"""
股票筛选 API

根据市场、起止年份、毛利率/净利率/营收同比阈值，
从 core_metrics 年度数据中计算历年均值，筛选出满足条件的公司。
"""
from fastapi import APIRouter, Query
from sqlalchemy import func, and_
from typing import Optional, List

from app.core.database import SessionLocal
from app.models.models import Company, CoreMetric

router = APIRouter()

MARKET_MAP = {
    "A股": [".SH", ".SZ", ".BJ"],
    "港股": [".HK"],
    "美股": [".O", ".N", ".A"],
}


@router.get("/screener")
def screen_stocks(
    market: str = Query(..., description="市场：A股/港股/美股"),
    start_year: int = Query(..., description="起始年份"),
    end_year: Optional[int] = Query(None, description="终止年份，空表示截止当前"),
    gross_margin_min: Optional[float] = Query(None, description="毛利率均值下限%"),
    net_margin_min: Optional[float] = Query(None, description="净利率均值下限%"),
    revenue_yoy_min: Optional[float] = Query(None, description="营收同比均值下限%"),
):
    import datetime
    if end_year is None:
        end_year = datetime.date.today().year

    suffixes = MARKET_MAP.get(market)
    if not suffixes:
        return {"success": False, "message": f"不支持的市场: {market}", "results": []}

    db = SessionLocal()
    try:
        # 查询所有在该市场、指定年份范围内的公司年度指标
        conditions = [
            CoreMetric.report_type == "annual",
            CoreMetric.report_year >= start_year,
            CoreMetric.report_year <= end_year,
        ]

        # 构建市场过滤：company.code 以指定后缀结尾
        from sqlalchemy import or_
        code_filters = []
        for suffix in suffixes:
            code_filters.append(Company.code.endswith(suffix))
        conditions.append(or_(*code_filters))

        # 联表查询
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
            .filter(and_(*conditions))
            .all()
        )

        if not query:
            return {
                "success": True,
                "message": f"未找到 {market} 在 {start_year}-{end_year} 年范围内的数据",
                "results": [],
                "total": 0,
            }

        # 按公司分组，计算各指标的历年均值
        from collections import defaultdict
        company_data = defaultdict(lambda: {
            "code": "", "name": "", "currency": "",
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

        # 计算均值并筛选
        results = []
        for cid, info in company_data.items():
            avg_gm = sum(info["gross_margins"]) / len(info["gross_margins"]) if info["gross_margins"] else None
            avg_nm = sum(info["net_margins"]) / len(info["net_margins"]) if info["net_margins"] else None
            avg_ryoy = sum(info["revenue_yoys"]) / len(info["revenue_yoys"]) if info["revenue_yoys"] else None
            years_sorted = sorted(info["years"])
            year_count = len(years_sorted)

            # 筛选条件
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
                "year_count": year_count,
                "avg_gross_margin": round(avg_gm, 2) if avg_gm is not None else None,
                "avg_net_margin": round(avg_nm, 2) if avg_nm is not None else None,
                "avg_revenue_yoy": round(avg_ryoy, 2) if avg_ryoy is not None else None,
            })

        # 按毛利率均值降序排列
        results.sort(
            key=lambda x: (x["avg_gross_margin"] or 0),
            reverse=True,
        )

        return {
            "success": True,
            "message": f"找到 {len(results)} 家符合条件的公司",
            "results": results,
            "total": len(results),
        }
    finally:
        db.close()
