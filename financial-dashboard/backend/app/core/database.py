from sqlalchemy import create_engine, inspect, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

from app.core.config import settings

engine = create_engine(
    settings.DATABASE_URL,
    connect_args={"check_same_thread": False},
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def ensure_schema():
    """创建表结构，并为已有数据库补齐新增字段。"""
    Base.metadata.create_all(bind=engine)

    inspector = inspect(engine)
    if "companies" not in inspector.get_table_names():
        return

    # companies 表字段补齐
    columns = {column["name"] for column in inspector.get_columns("companies")}
    with engine.begin() as conn:
        if "logo_url" not in columns:
            conn.execute(text("ALTER TABLE companies ADD COLUMN logo_url VARCHAR"))
        if "currency" not in columns:
            conn.execute(text("ALTER TABLE companies ADD COLUMN currency VARCHAR DEFAULT 'CNY'"))

    # core_metrics 表字段补齐
    if "core_metrics" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("core_metrics")}
    new_cols = [
        "revenue_yoy", "gross_profit_yoy", "net_profit_yoy",
        "revenue_qoq", "gross_profit_qoq", "net_profit_qoq",
    ]
    with engine.begin() as conn:
        for col in new_cols:
            if col not in columns:
                conn.execute(text("ALTER TABLE core_metrics ADD COLUMN %s FLOAT" % col))


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
