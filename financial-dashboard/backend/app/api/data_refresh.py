from fastapi import APIRouter, HTTPException
from loguru import logger

from app.core.database import SessionLocal
from app.models.models import Company, CoreMetric
from app.services.fetcher import EastMoneyFetcher
from app.tasks.scheduler import update_company_data, _save_metrics

router = APIRouter()


@router.post("/data-refresh/{code}")
def refresh_company_data(code: str):
    """手动触发指定公司的财务数据更新。"""
    db = SessionLocal()
    try:
        company = db.query(Company).filter(Company.code == code).first()
        if not company:
            raise HTTPException(status_code=404, detail=f"公司 {code} 未找到")

        target = {
            "code": company.code,
            "name": company.name,
            "logo_url": company.logo_url,
            "currency": company.currency,
        }

        update_company_data(target)

        # 统计更新后的数据条数
        annual_count = db.query(CoreMetric).filter(
            CoreMetric.company_id == company.id,
            CoreMetric.report_type == "annual"
        ).count()

        quarter_count = db.query(CoreMetric).filter(
            CoreMetric.company_id == company.id,
            CoreMetric.report_type != "annual"
        ).count()

        return {
            "success": True,
            "message": f"{company.name}({code}) 数据更新成功",
            "annual_records": annual_count,
            "quarter_records": quarter_count,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error("手动更新 {} 数据失败: {}", code, e)
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()
