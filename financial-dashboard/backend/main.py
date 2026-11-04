from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

from app.core.database import ensure_schema
from app.core.config import settings
from app.api import companies, metrics, business_updates, data_refresh, portfolio, closed_positions
from app.tasks.scheduler import start_scheduler

ensure_schema()

app = FastAPI(title="Financial Dashboard API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(companies.router, prefix=settings.API_PREFIX)
app.include_router(business_updates.router, prefix=settings.API_PREFIX)
app.include_router(data_refresh.router, prefix=settings.API_PREFIX)
app.include_router(portfolio.router, prefix=settings.API_PREFIX)
app.include_router(metrics.router, prefix=settings.API_PREFIX)
app.include_router(closed_positions.router, prefix=settings.API_PREFIX)

@app.on_event("startup")
def startup_event():
    logger.info("启动定时任务...")
    try:
        start_scheduler()
    except Exception as e:
        logger.error(e)

@app.get("/")
def root():
    return {"message": "Financial Dashboard API", "status": "running"}

@app.get("/health")
def health():
    return {"status": "ok"}
