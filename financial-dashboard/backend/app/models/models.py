from sqlalchemy import Column, Integer, String, Float, DateTime, Text, UniqueConstraint
from sqlalchemy.sql import func
from app.core.database import Base


class Company(Base):
    __tablename__ = "companies"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String, unique=True, index=True, nullable=False)
    name = Column(String, nullable=False)
    exchange = Column(String)
    logo_url = Column(String)
    currency = Column(String, default="CNY")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class FinancialReport(Base):
    __tablename__ = "financial_reports"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, index=True, nullable=False)
    report_year = Column(Integer, nullable=False)
    report_type = Column(String, nullable=False, default="annual")  # annual/q1/q2/q3
    statement_type = Column(String, nullable=False)  # income/balance/cashflow
    item_code = Column(String, nullable=False)
    item_name = Column(String)
    value = Column(Float)
    unit = Column(String, default="元")

    __table_args__ = (
        UniqueConstraint(
            "company_id", "report_year", "report_type",
            "statement_type", "item_code",
            name="uq_financial_item"
        ),
    )


class CoreMetric(Base):
    __tablename__ = "core_metrics"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, index=True, nullable=False)
    report_year = Column(Integer, nullable=False)
    report_type = Column(String, nullable=False, default="annual")
    revenue = Column(Float)
    gross_profit = Column(Float)
    net_profit = Column(Float)
    gross_margin = Column(Float)  # %
    net_margin = Column(Float)   # %
    free_cash_flow = Column(Float)
    # 同比增速 (year-over-year, %)
    revenue_yoy = Column(Float)
    gross_profit_yoy = Column(Float)
    net_profit_yoy = Column(Float)
    # 环比增速 (quarter-over-quarter, %), 仅季度数据有意义
    revenue_qoq = Column(Float)
    gross_profit_qoq = Column(Float)
    net_profit_qoq = Column(Float)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint(
            "company_id", "report_year", "report_type",
            name="uq_core_metric"
        ),
    )


class BusinessUpdate(Base):
    """业绩速报 - 港股Q3等自愿性公告数据（东方财富API不覆盖）"""
    __tablename__ = "business_updates"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, index=True, nullable=False)
    report_year = Column(Integer, nullable=False)
    report_period = Column(String, nullable=False)  # Q1/Q2/Q3/Q4/H1/H2
    announce_date = Column(String, nullable=False)  # 公告日期 YYYY-MM-DD
    title = Column(String, nullable=False)  # 公告标题
    summary = Column(Text)  # 摘要
    # 整体指标
    revenue_yoy_min = Column(Float)  # 收益同比下限 %
    revenue_yoy_max = Column(Float)  # 收益同比上限 %
    # 分区域数据 (JSON string)
    regions = Column(Text)  # [{"name":"中国","yoy_min":-30,"yoy_max":-25}, ...]
    # 分渠道数据 (JSON string)
    channels = Column(Text)  # [{"name":"线下","yoy_min":-10,"yoy_max":-5}, ...]
    source = Column(String)  # 数据来源
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint(
            "company_id", "report_year", "report_period",
            name="uq_business_update"
        ),
    )
