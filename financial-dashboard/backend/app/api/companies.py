from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from loguru import logger
import requests

from app.core.database import SessionLocal
from app.models.models import Company
from app.tasks.scheduler import update_company_data

router = APIRouter()


class CompanyCreate(BaseModel):
    code: str
    name: str = ''


def _auto_complete_code(code: str) -> str:
    """自动补全股票代码后缀。"""
    c = code.strip().upper()
    valid_suffixes = ['.SH', '.SZ', '.BJ', '.HK', '.O', '.N', '.A']
    if any(c.endswith(s) for s in valid_suffixes):
        return c
    if c.isdigit():
        if c.startswith(('600', '601', '603', '605', '688')):
            return c + '.SH'
        if c.startswith(('000', '001', '002', '003', '300', '301')):
            return c + '.SZ'
        if c.startswith(('430', '83', '87', '88', '92')):
            return c + '.BJ'
        if c.startswith('0') or c.startswith('8') or (1 <= len(c) <= 5):
            return c + '.HK'
        return c + '.SZ'
    if c.isalpha():
        return c + '.O'
    return c


def _detect_market(code: str) -> str:
    c = code.upper()
    if c.endswith('.HK'):
        return '港股'
    if c.endswith('.O') or c.endswith('.N') or c.endswith('.A'):
        return '美股'
    return 'A股'


def _detect_currency(code: str) -> str:
    c = code.upper()
    if c.endswith('.HK'):
        return 'HKD'
    if c.endswith('.O') or c.endswith('.N') or c.endswith('.A'):
        return 'USD'
    return 'CNY'


def _search_stock_name(code: str) -> tuple:
    """通过东方财富搜索API获取股票名称。"""
    try:
        url = 'https://searchapi.eastmoney.com/api/suggest/get'
        params = {'input': code, 'type': '14', 'count': '5'}
        resp = requests.get(url, params=params, timeout=10)
        data = resp.json()
        items = data.get('QuotationCodeTable', {}).get('Data', [])
        for item in items:
            item_code = item.get('Code', '')
            name = item.get('Name', '')
            if item_code.upper() == code.upper() or item_code.upper() == code.split('.')[0].upper():
                return name, True
        return '', False
    except Exception as e:
        logger.warning('搜索股票名称失败: {}', e)
        return '', False


@router.get("/companies")
def get_companies():
    from app.core.database import SessionLocal
    db = SessionLocal()
    try:
        companies = db.query(Company).all()
        return [
            {
                "id": c.id,
                "code": c.code,
                "name": c.name,
                "exchange": c.exchange,
                "logo_url": c.logo_url,
                "currency": c.currency or "CNY"
            }
            for c in companies
        ]
    finally:
        db.close()


@router.post("/companies")
def add_company(item: CompanyCreate):
    """添加新公司并自动抓取财务数据。"""
    db = SessionLocal()
    try:
        full_code = _auto_complete_code(item.code)

        # 检查是否已存在
        existing = db.query(Company).filter(Company.code == full_code).first()
        if existing:
            raise HTTPException(status_code=400, detail=f'公司 {full_code} 已存在')

        # 获取股票名称（如果未提供）
        name = item.name.strip()
        if not name:
            searched_name, found = _search_stock_name(full_code)
            if found:
                name = searched_name
            else:
                raise HTTPException(status_code=400, detail=f'无法获取 {full_code} 的股票名称，请手动填写')

        market = _detect_market(full_code)
        currency = _detect_currency(full_code)

        # 创建公司记录
        company = Company(
            code=full_code,
            name=name,
            exchange=market,
            currency=currency,
        )
        db.add(company)
        db.commit()
        db.refresh(company)

        # 自动抓取财务数据
        target = {
            "code": full_code,
            "name": name,
            "logo_url": None,
            "currency": currency,
        }
        try:
            update_company_data(target)
        except Exception as e:
            logger.warning('抓取 {} 财务数据失败: {}', full_code, e)
            # 财务数据抓取失败不影响公司创建

        return {
            "success": True,
            "id": company.id,
            "code": full_code,
            "name": name,
            "message": f'{name}({full_code}) 添加成功',
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error('添加公司失败: {}', e)
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()
