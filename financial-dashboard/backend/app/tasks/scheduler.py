from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from loguru import logger
import pytz

from app.core.config import settings
from app.services.fetcher import EastMoneyFetcher
from app.core.database import SessionLocal
from app.models.models import Company, CoreMetric


scheduler = BackgroundScheduler(timezone=pytz.timezone(settings.TZ))


def _safe_yoy(current, previous):
    if current is None or previous is None or previous == 0:
        return None
    return round((current - previous) / abs(previous) * 100, 2)


def _safe_qoq(current, previous):
    if current is None or previous is None or previous == 0:
        return None
    return round((current - previous) / abs(previous) * 100, 2)


def _save_metrics(db, company_id, metrics, is_quarterly=False):
    """保存指标到数据库，计算同比和环比增速。"""
    # 构建查找索引: {(year, report_type): metric}
    index = {}
    for m in metrics:
        index[(m["report_year"], m["report_type"])] = m

    # 季度/半年度的顺序，用于环比
    q_order = ["q1", "q2", "q3", "q4", "h1", "h2"]

    for metric in metrics:
        year = metric["report_year"]
        rt = metric["report_type"]

        # 同比：去年同类型
        yoy_data = index.get((year - 1, rt))

        # 环比：同一年前一个周期
        qoq_data = None
        if is_quarterly and rt in q_order:
            idx = q_order.index(rt)
            if idx > 0:
                prev_rt = q_order[idx - 1]
                qoq_data = index.get((year, prev_rt))
            elif rt == "q1":
                # Q1 环比 = 去年 Q4
                qoq_data = index.get((year - 1, "q4"))

        metric["revenue_yoy"] = _safe_yoy(metric.get("revenue"), yoy_data.get("revenue")) if yoy_data else None
        metric["gross_profit_yoy"] = _safe_yoy(metric.get("gross_profit"), yoy_data.get("gross_profit")) if yoy_data else None
        metric["net_profit_yoy"] = _safe_yoy(metric.get("net_profit"), yoy_data.get("net_profit")) if yoy_data else None
        metric["revenue_qoq"] = _safe_qoq(metric.get("revenue"), qoq_data.get("revenue")) if qoq_data else None
        metric["gross_profit_qoq"] = _safe_qoq(metric.get("gross_profit"), qoq_data.get("gross_profit")) if qoq_data else None
        metric["net_profit_qoq"] = _safe_qoq(metric.get("net_profit"), qoq_data.get("net_profit")) if qoq_data else None

        existing = db.query(CoreMetric).filter(
            CoreMetric.company_id == company_id,
            CoreMetric.report_year == year,
            CoreMetric.report_type == rt,
        ).first()

        if existing:
            for key, value in metric.items():
                if key not in ["report_year", "report_type", "label", "quarter", "period_type"]:
                    setattr(existing, key, value)
        else:
            db_metric = {k: v for k, v in metric.items() if k not in ["label", "quarter", "period_type"]}
            db_metric["company_id"] = company_id
            db.add(CoreMetric(**db_metric))

    db.commit()


def update_company_data(target):
    """更新单个公司的年度+季度核心指标。"""
    code = target["code"]
    name = target["name"]
    db = SessionLocal()
    try:
        company = db.query(Company).filter(Company.code == code).first()
        if not company:
            company = Company(
                code=code,
                name=name,
                logo_url=target.get("logo_url"),
                currency=target.get("currency", "CNY"),
            )
            db.add(company)
            db.commit()
            db.refresh(company)
        else:
            company.name = name
            if target.get("logo_url"):
                company.logo_url = target["logo_url"]
            if target.get("currency"):
                company.currency = target["currency"]
            db.commit()

        fetcher = EastMoneyFetcher()
        financial_data = fetcher.get_financial_data(code)

        # 1. 年度数据
        annual_metrics = fetcher.calculate_core_metrics(financial_data)
        if annual_metrics:
            _save_metrics(db, company.id, annual_metrics, is_quarterly=False)
            valid_years = [m["report_year"] for m in annual_metrics]
            db.query(CoreMetric).filter(
                CoreMetric.company_id == company.id,
                CoreMetric.report_type == "annual",
                ~CoreMetric.report_year.in_(valid_years)
            ).delete(synchronize_session=False)
            db.commit()
            logger.info("{}({}) 年度数据更新完成，共 {} 条", name, code, len(annual_metrics))
        else:
            logger.warning("{}({}) 未获取到年度财务数据", name, code)

        # 2. 季度/半年度数据
        quarterly_metrics = fetcher.get_quarterly_metrics(financial_data)
        if quarterly_metrics:
            q_metrics = []
            for q in quarterly_metrics:
                label = q.get("label", "")
                if "Q" in label:
                    rt = "q" + label.split("Q")[1]
                elif "H" in label:
                    rt = "h" + label.split("H")[1]
                else:
                    continue
                year = int(label[:4])
                q_metrics.append({
                    "report_year": year,
                    "report_type": rt,
                    "revenue": q.get("revenue"),
                    "gross_profit": q.get("gross_profit"),
                    "net_profit": q.get("net_profit"),
                    "gross_margin": q.get("gross_margin"),
                    "net_margin": q.get("net_margin"),
                    "free_cash_flow": None,
                })

            if q_metrics:
                _save_metrics(db, company.id, q_metrics, is_quarterly=True)
                valid_q = [(m["report_year"], m["report_type"]) for m in q_metrics]
                for m in db.query(CoreMetric).filter(
                    CoreMetric.company_id == company.id,
                    CoreMetric.report_type != "annual"
                ).all():
                    if (m.report_year, m.report_type) not in valid_q:
                        db.delete(m)
                db.commit()
                logger.info("{}({}) 季度数据更新完成，共 {} 条", name, code, len(q_metrics))
        else:
            logger.warning("{}({}) 未获取到季度财务数据", name, code)

        detected_currency = financial_data.get("currency")
        if detected_currency and company.currency != detected_currency:
            company.currency = detected_currency
            db.commit()

    except Exception as e:
        logger.error("{}({}) 更新财务数据失败: {}", name, code, e)
        db.rollback()
    finally:
        db.close()


def update_financial_data():
    logger.info("开始更新财务数据...")
    for target in settings.TARGET_COMPANIES:
        update_company_data(target)
    logger.info("全部公司财务数据更新完成")


def start_scheduler():
    scheduler.add_job(
        update_financial_data,
        CronTrigger(hour=settings.UPDATE_HOUR, minute=settings.UPDATE_MINUTE),
        id="daily_financial_update",
        replace_existing=True
    )
    scheduler.start()
    logger.info("定时任务已启动，每日 {:02d}:{:02d} 更新数据", settings.UPDATE_HOUR, settings.UPDATE_MINUTE)
    update_financial_data()
