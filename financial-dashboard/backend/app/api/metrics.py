from fastapi import APIRouter, Query
from app.core.database import SessionLocal
from app.models.models import CoreMetric, Company

router = APIRouter()


@router.get("/metrics")
def get_metrics(code: str = Query(None)):
    db = SessionLocal()
    try:
        company = db.query(Company).filter(Company.code == code).first() if code else None
        if code and not company:
            return []
        if company:
            metrics = (
                db.query(CoreMetric)
                .filter(CoreMetric.company_id == company.id, CoreMetric.report_type == "annual")
                .order_by(CoreMetric.report_year.desc())
                .all()
            )
        else:
            metrics = (
                db.query(CoreMetric)
                .filter(CoreMetric.report_type == "annual")
                .order_by(CoreMetric.report_year.desc())
                .all()
            )
        result = []
        for m in metrics:
            result.append({
                "year": m.report_year,
                "report_type": m.report_type,
                "revenue": m.revenue,
                "gross_profit": m.gross_profit,
                "net_profit": m.net_profit,
                "gross_margin": m.gross_margin,
                "net_margin": m.net_margin,
                "free_cash_flow": m.free_cash_flow,
                "revenue_yoy": m.revenue_yoy,
                "gross_profit_yoy": m.gross_profit_yoy,
                "net_profit_yoy": m.net_profit_yoy,
            })
        return result
    finally:
        db.close()


@router.get("/metrics/quarterly")
def get_quarterly_metrics(code: str = Query("300750.SZ")):
    db = SessionLocal()
    try:
        company = db.query(Company).filter(Company.code == code).first()
        if not company:
            return []

        metrics = (
            db.query(CoreMetric)
            .filter(
                CoreMetric.company_id == company.id,
                CoreMetric.report_type != "annual",
            )
            .order_by(CoreMetric.report_year.desc(), CoreMetric.report_type.desc())
            .all()
        )

        # 构建 label 和 quarter 名称
        type_labels = {
            "q1": "第一季度", "q2": "第二季度",
            "q3": "第三季度", "q4": "第四季度",
            "h1": "上半年", "h2": "下半年",
        }
        # 判断是否半年度模式
        is_half_year = any(m.report_type.startswith("h") for m in metrics)

        result = []
        for m in metrics:
            label = "{}{}".format(m.report_year, m.report_type.upper())
            result.append({
                "label": label,
                "year": m.report_year,
                "quarter": type_labels.get(m.report_type, m.report_type),
                "revenue": m.revenue,
                "gross_profit": m.gross_profit,
                "net_profit": m.net_profit,
                "gross_margin": m.gross_margin,
                "net_margin": m.net_margin,
                "period_type": "half_year" if is_half_year else "quarter",
                "revenue_yoy": m.revenue_yoy,
                "gross_profit_yoy": m.gross_profit_yoy,
                "net_profit_yoy": m.net_profit_yoy,
                "revenue_qoq": m.revenue_qoq,
                "gross_profit_qoq": m.gross_profit_qoq,
                "net_profit_qoq": m.net_profit_qoq,
            })

        # 按 label 升序排列（时间正序）
        result.sort(key=lambda x: x["label"])
        return result
    finally:
        db.close()
