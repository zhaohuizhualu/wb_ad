from fastapi import APIRouter, Query
from app.core.database import SessionLocal
from app.models.models import BusinessUpdate, Company
import json

router = APIRouter()


@router.get("/business-updates")
def get_business_updates(code: str = Query(None)):
    db = SessionLocal()
    try:
        company = db.query(Company).filter(Company.code == code).first() if code else None
        if code and not company:
            return []
        if company:
            updates = (
                db.query(BusinessUpdate)
                .filter(BusinessUpdate.company_id == company.id)
                .order_by(BusinessUpdate.announce_date.desc())
                .all()
            )
        else:
            updates = db.query(BusinessUpdate).order_by(BusinessUpdate.announce_date.desc()).all()

        result = []
        for u in updates:
            result.append({
                "id": u.id,
                "company_id": u.company_id,
                "report_year": u.report_year,
                "report_period": u.report_period,
                "announce_date": u.announce_date,
                "title": u.title,
                "summary": u.summary,
                "revenue_yoy_min": u.revenue_yoy_min,
                "revenue_yoy_max": u.revenue_yoy_max,
                "regions": json.loads(u.regions) if u.regions else [],
                "channels": json.loads(u.channels) if u.channels else [],
                "source": u.source,
            })
        return result
    finally:
        db.close()
