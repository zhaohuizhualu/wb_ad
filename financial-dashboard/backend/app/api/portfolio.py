from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from loguru import logger
import requests
import time

from app.core.database import SessionLocal
from app.models.models import Company

router = APIRouter()

# 汇率缓存（减少API调用）
_exchange_cache = {"rates": {}, "timestamp": 0}
EXCHANGE_CACHE_TTL = 3600  # 1小时


class PortfolioCreate(BaseModel):
    code: str
    name: str
    market: str
    shares: float
    avg_cost: Optional[float] = None
    fee: Optional[float] = None
    notes: Optional[str] = None


class PortfolioUpdate(BaseModel):
    shares: Optional[float] = None
    avg_cost: Optional[float] = None
    fee: Optional[float] = None
    notes: Optional[str] = None


def _auto_complete_code(code: str) -> str:
    """自动补全股票代码后缀。无后缀时根据前缀推断市场。"""
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
    if c.endswith('.SH') or c.endswith('.SZ') or c.endswith('.BJ'):
        return 'A股'
    return 'A股'


def _get_secid(code: str) -> str:
    c = code.upper()
    if c.endswith('.SH'):
        return '1.' + c.replace('.SH', '')
    if c.endswith('.SZ'):
        return '0.' + c.replace('.SZ', '')
    if c.endswith('.BJ'):
        return '0.' + c.replace('.BJ', '')
    if c.endswith('.HK'):
        return '116.' + c.replace('.HK', '')
    if c.endswith('.O'):
        return '105.' + c.replace('.O', '')
    if c.endswith('.N'):
        return '106.' + c.replace('.N', '')
    if c.endswith('.A'):
        return '107.' + c.replace('.A', '')
    return '0.' + c


def _fetch_last_close_price(code: str) -> tuple:
    """获取最新实时价格（f43），fallback 到昨收（f60）。"""
    try:
        secid = _get_secid(code)
        url = 'https://push2.eastmoney.com/api/qt/stock/get'
        params = {
            'secid': secid,
            'fields': 'f43,f44,f45,f46,f47,f48,f57,f58,f60,f170',
            'fltt': 2,
        }
        resp = requests.get(url, params=params, timeout=10)
        data = resp.json()
        info = data.get('data')
        if not info:
            logger.warning('东方财富未找到股票: {} (secid={})', code, secid)
            return None, None

        # f43 = 最新实时价（盘中/盘前/盘后），f60 = 昨收
        latest = info.get('f43')
        last_close = info.get('f60')

        # 优先使用最新实时价，若不可用则 fallback 到昨收
        price = latest if latest is not None else last_close

        from datetime import datetime
        date_str = datetime.now().strftime('%Y-%m-%d')

        return price, date_str
    except Exception as e:
        logger.warning('获取 {} 股价失败: {}', code, e)
        return None, None


def _validate_stock_code(code: str) -> tuple:
    """验证股票代码是否有效，返回 (是否有效, 错误信息)。"""
    c = code.upper()
    valid_suffixes = ['.SH', '.SZ', '.BJ', '.HK', '.O', '.N', '.A']
    has_suffix = any(c.endswith(s) for s in valid_suffixes)
    if not has_suffix and not c.isdigit() and not c.isalpha():
        return False, '股票代码格式不正确'

    last_price, _ = _fetch_last_close_price(code)
    if last_price is None:
        if not has_suffix:
            return False, '无法获取该股票行情。请检查代码是否正确，或手动添加后缀（如 .SH/.SZ/.HK/.O）'
        return False, '无法获取该股票行情，请检查代码是否正确'

    return True, ''


def _get_exchange_rates() -> dict:
    """获取实时汇率（USD->CNY, HKD->CNY），带缓存。"""
    global _exchange_cache
    now = time.time()
    if now - _exchange_cache["timestamp"] < EXCHANGE_CACHE_TTL and _exchange_cache["rates"]:
        return _exchange_cache["rates"]

    rates = {"USD": 1.0, "HKD": 1.0, "CNY": 1.0}
    try:
        resp = requests.get('https://open.er-api.com/v6/latest/USD', timeout=10)
        data = resp.json()
        if data.get('result') == 'success':
            usd_rates = data.get('rates', {})
            rates['USD'] = usd_rates.get('CNY', 7.2)
            resp2 = requests.get('https://open.er-api.com/v6/latest/HKD', timeout=10)
            data2 = resp2.json()
            if data2.get('result') == 'success':
                rates['HKD'] = data2.get('rates', {}).get('CNY', 0.92)
    except Exception as e:
        logger.warning('获取汇率失败: {}，使用默认值', e)
        rates = {"USD": 7.2, "HKD": 0.92, "CNY": 1.0}

    _exchange_cache = {"rates": rates, "timestamp": now}
    logger.info('汇率更新: USD={:.4f}, HKD={:.4f}', rates['USD'], rates['HKD'])
    return rates


def _search_stocks(query: str, limit: int = 5):
    """搜索股票联想。"""
    try:
        url = 'https://searchapi.eastmoney.com/api/suggest/get'
        params = {'input': query, 'type': '14', 'count': str(limit)}
        resp = requests.get(url, params=params, timeout=10)
        data = resp.json()
        items = data.get('QuotationCodeTable', {}).get('Data', [])
        results = []
        for item in items:
            code = item.get('Code', '')
            name = item.get('Name', '')
            quote_id = item.get('QuoteID', '')
            sec_type = item.get('SecurityTypeName', '')

            suffix = ''
            if quote_id.startswith('1.'):
                suffix = '.SH'
            elif quote_id.startswith('0.'):
                suffix = '.SZ'
            elif quote_id.startswith('116.'):
                suffix = '.HK'
            elif quote_id.startswith('105.'):
                suffix = '.O'
            elif quote_id.startswith('106.'):
                suffix = '.N'
            elif quote_id.startswith('107.'):
                suffix = '.A'

            if sec_type in ('沪A', '深A', '京A', '港股', '美股'):
                results.append({
                    'code': code + suffix,
                    'name': name,
                    'market_type': sec_type,
                })
        return results
    except Exception as e:
        logger.warning('搜索股票失败: {}', e)
        return []


# ---------- Database helpers ----------

def _get_db_connection():
    import sqlite3
    from app.core.config import settings
    return sqlite3.connect(str(settings.BASE_DIR / 'data' / 'db.sqlite3'))


def _init_portfolio_table():
    conn = _get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS portfolio (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code VARCHAR NOT NULL UNIQUE,
            name VARCHAR NOT NULL,
            market VARCHAR NOT NULL DEFAULT 'A股',
            shares FLOAT NOT NULL DEFAULT 0,
            avg_cost FLOAT,
            fee FLOAT DEFAULT 0,
            last_price FLOAT,
            last_price_date VARCHAR,
            notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    # Add fee column if it doesn't exist (for existing tables)
    try:
        cursor.execute('PRAGMA table_info(portfolio)')
        columns = [row[1] for row in cursor.fetchall()]
        if 'fee' not in columns:
            cursor.execute('ALTER TABLE portfolio ADD COLUMN fee FLOAT DEFAULT 0')
    except:
        pass
    conn.commit()
    conn.close()


# ---------- API Routes ----------

@router.get('/stock-search')
def stock_search(q: str = '', limit: int = 5):
    """股票搜索联想。"""
    if not q or len(q.strip()) < 1:
        return []
    results = _search_stocks(q.strip(), limit)
    return results[:limit]


@router.get('/portfolio')
def list_portfolio():
    _init_portfolio_table()
    conn = _get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT id, code, name, market, shares, avg_cost, fee, last_price, last_price_date, notes
        FROM portfolio ORDER BY id DESC
    ''')
    rows = cursor.fetchall()
    conn.close()

    items = []
    for row in rows:
        items.append({
            'id': row[0], 'code': row[1], 'name': row[2], 'market': row[3],
            'shares': row[4], 'avg_cost': row[5], 'fee': row[6],
            'last_price': row[7], 'last_price_date': row[8], 'notes': row[9],
        })
    return items


@router.post('/portfolio')
def add_portfolio(item: PortfolioCreate):
    _init_portfolio_table()

    full_code = _auto_complete_code(item.code)
    market = item.market or _detect_market(full_code)

    valid, err_msg = _validate_stock_code(full_code)
    if not valid:
        raise HTTPException(status_code=400, detail=err_msg)

    last_price, last_date = _fetch_last_close_price(full_code)

    conn = _get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('''
            INSERT INTO portfolio (code, name, market, shares, avg_cost, fee, last_price, last_price_date, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (full_code, item.name, market, item.shares, item.avg_cost, item.fee or 0, last_price, last_date, item.notes))
        conn.commit()
        new_id = cursor.lastrowid
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        conn.close()

    return {
        'id': new_id, 'code': full_code, 'name': item.name, 'market': market,
        'shares': item.shares, 'avg_cost': item.avg_cost, 'fee': item.fee or 0,
        'last_price': last_price, 'last_price_date': last_date, 'notes': item.notes,
    }


@router.put('/portfolio/{item_id}')
def update_portfolio(item_id: int, item: PortfolioUpdate):
    _init_portfolio_table()
    conn = _get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT id FROM portfolio WHERE id = ?', (item_id,))
    if not cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail='持仓记录不存在')

    updates = []
    params = []
    if item.shares is not None:
        updates.append('shares = ?')
        params.append(item.shares)
    if item.avg_cost is not None:
        updates.append('avg_cost = ?')
        params.append(item.avg_cost)
    if item.fee is not None:
        updates.append('fee = ?')
        params.append(item.fee)
    if item.notes is not None:
        updates.append('notes = ?')
        params.append(item.notes)

    if not updates:
        conn.close()
        raise HTTPException(status_code=400, detail='没有要更新的字段')

    params.append(item_id)
    cursor.execute(f"UPDATE portfolio SET {', '.join(updates)}, updated_at = CURRENT_TIMESTAMP WHERE id = ?", params)
    conn.commit()
    conn.close()
    return {'success': True, 'id': item_id}


@router.delete('/portfolio/{item_id}')
def delete_portfolio(item_id: int):
    _init_portfolio_table()
    conn = _get_db_connection()
    cursor = conn.cursor()
    cursor.execute('DELETE FROM portfolio WHERE id = ?', (item_id,))
    conn.commit()
    deleted = cursor.rowcount
    conn.close()
    if deleted == 0:
        raise HTTPException(status_code=404, detail='持仓记录不存在')
    return {'success': True, 'id': item_id}


@router.post('/portfolio/refresh-prices')
def refresh_portfolio_prices():
    _init_portfolio_table()
    conn = _get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT id, code FROM portfolio')
    rows = cursor.fetchall()

    updated = 0
    for row in rows:
        item_id, code = row
        last_price, last_date = _fetch_last_close_price(code)
        if last_price is not None:
            cursor.execute(
                'UPDATE portfolio SET last_price = ?, last_price_date = ? WHERE id = ?',
                (last_price, last_date, item_id)
            )
            updated += 1

    conn.commit()
    conn.close()
    return {'success': True, 'updated_count': updated}


@router.get('/portfolio/summary')
def portfolio_summary():
    _init_portfolio_table()
    conn = _get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT code, name, market, shares, avg_cost, fee, last_price, last_price_date
        FROM portfolio ORDER BY market, id DESC
    ''')
    rows = cursor.fetchall()
    conn.close()

    rates = _get_exchange_rates()

    markets = {'A股': [], '港股': [], '美股': []}
    totals = {'A股': 0.0, '港股': 0.0, '美股': 0.0}
    cost_totals = {'A股': 0.0, '港股': 0.0, '美股': 0.0}

    for row in rows:
        item = {
            'code': row[0], 'name': row[1], 'market': row[2],
            'shares': row[3], 'avg_cost': row[4], 'fee': row[5],
            'last_price': row[6], 'last_price_date': row[7],
        }
        market = item['market']
        if market not in markets:
            markets[market] = []
            totals[market] = 0.0
            cost_totals[market] = 0.0

        markets[market].append(item)

        rate = 1.0
        if market == '港股':
            rate = rates.get('HKD', 1.0)
        elif market == '美股':
            rate = rates.get('USD', 1.0)

        if item['last_price'] is not None and item['shares'] is not None:
            totals[market] += item['last_price'] * item['shares'] * rate
        if item['avg_cost'] is not None and item['shares'] is not None:
            cost_totals[market] += item['avg_cost'] * item['shares'] * rate

    summary = {}
    for market in markets:
        if markets[market]:
            summary[market] = {
                'items': markets[market],
                'total_market_value': round(totals[market], 2),
                'total_cost': round(cost_totals[market], 2),
                'total_profit': round(totals[market] - cost_totals[market], 2),
                'profit_rate': round((totals[market] - cost_totals[market]) / cost_totals[market] * 100, 2) if cost_totals[market] > 0 else None,
            }

    grand_total = sum(totals.values())
    grand_cost = sum(cost_totals.values())

    return {
        'markets': summary,
        'grand_total': round(grand_total, 2),
        'grand_cost': round(grand_cost, 2),
        'grand_profit': round(grand_total - grand_cost, 2),
        'grand_profit_rate': round((grand_total - grand_cost) / grand_cost * 100, 2) if grand_cost > 0 else None,
        'exchange_rates': {
            'USD_CNY': round(rates.get('USD', 1.0), 4),
            'HKD_CNY': round(rates.get('HKD', 1.0), 4),
            'updated_at': time.strftime('%Y-%m-%d %H:%M', time.localtime(_exchange_cache['timestamp'])),
        },
    }
