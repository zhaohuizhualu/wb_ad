from pathlib import Path

class Settings:
    APP_NAME = "financial-dashboard"
    API_PREFIX = "/api"
    BASE_DIR = Path(__file__).resolve().parents[2]
    DATABASE_URL = f"sqlite:///{BASE_DIR}/data/db.sqlite3"
    TARGET_COMPANIES = [
        {
            "code": "300750.SZ",
            "name": "宁德时代",
            "logo_url": "/logos/300750.SZ.svg",
            "currency": "CNY",
        },
        {
            "code": "600519.SH",
            "name": "贵州茅台",
            "logo_url": "/logos/600519.SH.svg",
            "currency": "CNY",
        },
        {
            "code": "09992.HK",
            "name": "泡泡玛特",
            "logo_url": "/logos/09992.HK.svg",
            "currency": "CNY",
        },
        {
            "code": "TSLA.O",
            "name": "特斯拉",
            "logo_url": "/logos/TSLA.O.svg",
            "currency": "USD",
        },
        {
            "code": "PDD.O",
            "name": "拼多多",
            "logo_url": "/logos/PDD.O.svg",
            "currency": "CNY",
        },
        {
            "code": "NVDA.O",
            "name": "英伟达",
            "logo_url": "/logos/NVDA.O.svg",
            "currency": "USD",
        },
        {
            "code": "AAPL.O",
            "name": "苹果",
            "logo_url": "/logos/AAPL.O.svg",
            "currency": "USD",
        },
    ]
    TZ = "Asia/Shanghai"
    UPDATE_HOUR = 6
    UPDATE_MINUTE = 0

settings = Settings()
