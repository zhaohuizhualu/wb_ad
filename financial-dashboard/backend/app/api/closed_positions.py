from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from loguru import logger
from datetime import datetime, date

router = APIRouter()


def _get_db_connection():
    import sqlite3
    from app.core.config import settings
    return sqlite3.connect(str(settings.BASE_DIR / 'data' / 'db.sqlite3'))


def _init_tables():
    conn = _get_db_connection()
    cursor = conn.cursor()

    # 已清仓股票
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS closed_stocks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code VARCHAR NOT NULL,
            name VARCHAR NOT NULL,
            market VARCHAR NOT NULL DEFAULT 'A股',
            buy_date VARCHAR,
            sell_date VARCHAR,
            shares FLOAT NOT NULL DEFAULT 0,
            buy_price FLOAT,
            sell_price FLOAT,
            fee FLOAT DEFAULT 0,
            notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    # 已清仓期权
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS closed_options (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            underlying_code VARCHAR NOT NULL,
            contract_code VARCHAR NOT NULL,
            market VARCHAR NOT NULL DEFAULT '美股',
            option_type VARCHAR,
            direction VARCHAR,
            strike_price FLOAT,
            open_date VARCHAR,
            close_date VARCHAR,
            contracts FLOAT NOT NULL DEFAULT 0,
            multiplier FLOAT DEFAULT 100,
            open_premium FLOAT,
            close_premium FLOAT,
            fee FLOAT DEFAULT 0,
            notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    # Add fee column if it doesn't exist (for existing tables)
    try:
        cursor.execute('PRAGMA table_info(closed_stocks)')
        columns = [row[1] for row in cursor.fetchall()]
        if 'fee' not in columns:
            cursor.execute('ALTER TABLE closed_stocks ADD COLUMN fee FLOAT DEFAULT 0')
    except:
        pass

    try:
        cursor.execute('PRAGMA table_info(closed_options)')
        columns = [row[1] for row in cursor.fetchall()]
        if 'fee' not in columns:
            cursor.execute('ALTER TABLE closed_options ADD COLUMN fee FLOAT DEFAULT 0')
    except:
        pass

    conn.commit()
    conn.close()


def _get_column_map(conn, table_name):
    """Get column name -> index mapping for a table."""
    cursor = conn.cursor()
    cursor.execute(f'PRAGMA table_info({table_name})')
    col_map = {}
    for row in cursor.fetchall():
        col_map[row[1]] = row[0]
    return col_map


# ---------- Pydantic Models ----------

class ClosedStockCreate(BaseModel):
    code: str
    name: str
    market: str = 'A股'
    buy_date: Optional[str] = None
    sell_date: Optional[str] = None
    shares: float
    buy_price: Optional[float] = None
    sell_price: Optional[float] = None
    fee: Optional[float] = None
    notes: Optional[str] = None

class ClosedStockUpdate(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    market: Optional[str] = None
    buy_date: Optional[str] = None
    sell_date: Optional[str] = None
    shares: Optional[float] = None
    buy_price: Optional[float] = None
    sell_price: Optional[float] = None
    fee: Optional[float] = None
    notes: Optional[str] = None

class ClosedOptionCreate(BaseModel):
    underlying_code: str
    contract_code: str
    market: str = '美股'
    option_type: Optional[str] = None
    direction: Optional[str] = None
    strike_price: Optional[float] = None
    open_date: Optional[str] = None
    close_date: Optional[str] = None
    contracts: float
    multiplier: float = 100
    open_premium: Optional[float] = None
    close_premium: Optional[float] = None
    fee: Optional[float] = None
    notes: Optional[str] = None

class ClosedOptionUpdate(BaseModel):
    underlying_code: Optional[str] = None
    contract_code: Optional[str] = None
    market: Optional[str] = None
    option_type: Optional[str] = None
    direction: Optional[str] = None
    strike_price: Optional[float] = None
    open_date: Optional[str] = None
    close_date: Optional[str] = None
    contracts: Optional[float] = None
    multiplier: Optional[float] = None
    open_premium: Optional[float] = None
    close_premium: Optional[float] = None
    fee: Optional[float] = None
    notes: Optional[str] = None


# ---------- Helpers ----------

def _days_between(d1: Optional[str], d2: Optional[str]) -> Optional[int]:
    if not d1 or not d2:
        return None
    try:
        dt1 = datetime.strptime(d1[:10], '%Y-%m-%d')
        dt2 = datetime.strptime(d2[:10], '%Y-%m-%d')
        return (dt2 - dt1).days
    except:
        return None

def _safe_float(v):
    """Convert value to float safely, return 0 for None/empty."""
    if v is None:
        return 0.0
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0

def _enrich_stock(row: tuple, col_map: dict) -> dict:
    """Enrich stock row using column name mapping."""
    def get(col_name, default=None):
        idx = col_map.get(col_name)
        if idx is not None and idx < len(row):
            return row[idx]
        return default

    fee = _safe_float(get('fee', 0))

    item = {
        'id': get('id'),
        'code': get('code', ''),
        'name': get('name', ''),
        'market': get('market', 'A股'),
        'buy_date': get('buy_date'),
        'sell_date': get('sell_date'),
        'shares': get('shares', 0),
        'buy_price': get('buy_price'),
        'sell_price': get('sell_price'),
        'fee': fee,
        'notes': get('notes'),
    }

    # 自动计算
    shares = _safe_float(item['shares'])
    buy_price = item['buy_price']
    sell_price = item['sell_price']
    buy_total = buy_price * shares if buy_price is not None else None
    sell_total = sell_price * shares if sell_price is not None else None
    # profit = (sell_total - buy_total) - fee
    profit = (sell_total - buy_total - fee) if (buy_total is not None and sell_total is not None) else None
    profit_rate = (profit / buy_total * 100) if (profit is not None and buy_total and buy_total > 0) else None
    holding_days = _days_between(item['buy_date'], item['sell_date'])
    annualized = None
    if profit_rate is not None and holding_days and holding_days > 0:
        annualized = profit_rate * 365 / holding_days

    item['buy_total'] = round(buy_total, 2) if buy_total is not None else None
    item['sell_total'] = round(sell_total, 2) if sell_total is not None else None
    item['profit'] = round(profit, 2) if profit is not None else None
    item['profit_rate'] = round(profit_rate, 2) if profit_rate is not None else None
    item['holding_days'] = holding_days
    item['annualized'] = round(annualized, 2) if annualized is not None else None
    return item

def _enrich_option(row: tuple, col_map: dict) -> dict:
    """Enrich option row using column name mapping."""
    def get(col_name, default=None):
        idx = col_map.get(col_name)
        if idx is not None and idx < len(row):
            return row[idx]
        return default

    fee = _safe_float(get('fee', 0))

    item = {
        'id': get('id'),
        'underlying_code': get('underlying_code', ''),
        'contract_code': get('contract_code', ''),
        'market': get('market', '美股'),
        'option_type': get('option_type'),
        'direction': get('direction'),
        'strike_price': get('strike_price'),
        'open_date': get('open_date'),
        'close_date': get('close_date'),
        'contracts': get('contracts', 0),
        'multiplier': get('multiplier', 100),
        'open_premium': get('open_premium'),
        'close_premium': get('close_premium'),
        'fee': fee,
        'notes': get('notes'),
    }

    contracts = _safe_float(item['contracts'])
    mult = _safe_float(item['multiplier']) or 100
    open_premium = item['open_premium']
    close_premium = item['close_premium']
    strike = item['strike_price']

    open_total = open_premium * contracts * mult if open_premium is not None else None
    close_total = close_premium * contracts * mult if close_premium is not None else None

    direction = (item['direction'] or '').lower()
    # Sell方向: 净权利金 = 开仓总额 - 平仓总额
    # Buy方向: 净权利金 = 平仓总额 - 开仓总额
    if direction.startswith('sell'):
        net_premium = (open_total - close_total) if (open_total is not None and close_total is not None) else None
    elif direction.startswith('buy'):
        net_premium = (close_total - open_total) if (open_total is not None and close_total is not None) else None
    else:
        net_premium = None

    # 减去手续费
    if net_premium is not None:
        net_premium = net_premium - fee

    # 保证金 = 行权价 × 合约数 × 乘数
    margin = strike * contracts * mult if (strike is not None and contracts and mult) else None

    # 收益率 = 净权利金 / 保证金
    profit_rate = (net_premium / margin * 100) if (net_premium is not None and margin and margin > 0) else None

    holding_days = _days_between(item['open_date'], item['close_date'])
    annualized = None
    if profit_rate is not None and holding_days and holding_days > 0:
        annualized = profit_rate * 365 / holding_days

    item['open_total'] = round(open_total, 2) if open_total is not None else None
    item['close_total'] = round(close_total, 2) if close_total is not None else None
    item['net_premium'] = round(net_premium, 2) if net_premium is not None else None
    item['margin'] = round(margin, 2) if margin is not None else None
    item['profit_rate'] = round(profit_rate, 2) if profit_rate is not None else None
    item['holding_days'] = holding_days
    item['annualized'] = round(annualized, 2) if annualized is not None else None
    return item


# ---------- Closed Stocks API ----------

@router.get('/closed-stocks')
def list_closed_stocks(market: Optional[str] = None):
    _init_tables()
    conn = _get_db_connection()
    col_map = _get_column_map(conn, 'closed_stocks')
    cursor = conn.cursor()
    if market:
        cursor.execute('SELECT * FROM closed_stocks WHERE market = ? ORDER BY sell_date DESC, id DESC', (market,))
    else:
        cursor.execute('SELECT * FROM closed_stocks ORDER BY market, sell_date DESC, id DESC')
    rows = cursor.fetchall()
    conn.close()
    return [_enrich_stock(r, col_map) for r in rows]

@router.post('/closed-stocks')
def add_closed_stock(item: ClosedStockCreate):
    _init_tables()
    conn = _get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('''
            INSERT INTO closed_stocks (code, name, market, buy_date, sell_date, shares, buy_price, sell_price, fee, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (item.code, item.name, item.market, item.buy_date, item.sell_date,
              item.shares, item.buy_price, item.sell_price, item.fee or 0, item.notes))
        conn.commit()
        new_id = cursor.lastrowid
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        conn.close()
    return {'success': True, 'id': new_id}

@router.put('/closed-stocks/{item_id}')
def update_closed_stock(item_id: int, item: ClosedStockUpdate):
    _init_tables()
    conn = _get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT id FROM closed_stocks WHERE id = ?', (item_id,))
    if not cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail='记录不存在')

    fields = ['code','name','market','buy_date','sell_date','shares','buy_price','sell_price','fee','notes']
    updates = []
    params = []
    data = item.dict(exclude_unset=True)
    for f in fields:
        if f in data and data[f] is not None:
            updates.append(f'{f} = ?')
            params.append(data[f])
    if not updates:
        conn.close()
        raise HTTPException(status_code=400, detail='没有要更新的字段')
    params.append(item_id)
    cursor.execute(f"UPDATE closed_stocks SET {', '.join(updates)} WHERE id = ?", params)
    conn.commit()
    conn.close()
    return {'success': True, 'id': item_id}

@router.delete('/closed-stocks/{item_id}')
def delete_closed_stock(item_id: int):
    _init_tables()
    conn = _get_db_connection()
    cursor = conn.cursor()
    cursor.execute('DELETE FROM closed_stocks WHERE id = ?', (item_id,))
    conn.commit()
    deleted = cursor.rowcount
    conn.close()
    if deleted == 0:
        raise HTTPException(status_code=404, detail='记录不存在')
    return {'success': True, 'id': item_id}


# ---------- Closed Options API ----------

@router.get('/closed-options')
def list_closed_options(market: Optional[str] = None):
    _init_tables()
    conn = _get_db_connection()
    col_map = _get_column_map(conn, 'closed_options')
    cursor = conn.cursor()
    if market:
        cursor.execute('SELECT * FROM closed_options WHERE market = ? ORDER BY close_date DESC, id DESC', (market,))
    else:
        cursor.execute('SELECT * FROM closed_options ORDER BY market, close_date DESC, id DESC')
    rows = cursor.fetchall()
    conn.close()
    return [_enrich_option(r, col_map) for r in rows]

@router.post('/closed-options')
def add_closed_option(item: ClosedOptionCreate):
    _init_tables()
    conn = _get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('''
            INSERT INTO closed_options (underlying_code, contract_code, market, option_type, direction,
                strike_price, open_date, close_date, contracts, multiplier, open_premium, close_premium, fee, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (item.underlying_code, item.contract_code, item.market, item.option_type, item.direction,
              item.strike_price, item.open_date, item.close_date, item.contracts, item.multiplier,
              item.open_premium, item.close_premium, item.fee or 0, item.notes))
        conn.commit()
        new_id = cursor.lastrowid
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        conn.close()
    return {'success': True, 'id': new_id}

@router.put('/closed-options/{item_id}')
def update_closed_option(item_id: int, item: ClosedOptionUpdate):
    _init_tables()
    conn = _get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT id FROM closed_options WHERE id = ?', (item_id,))
    if not cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail='记录不存在')

    fields = ['underlying_code','contract_code','market','option_type','direction','strike_price',
              'open_date','close_date','contracts','multiplier','open_premium','close_premium','fee','notes']
    updates = []
    params = []
    data = item.dict(exclude_unset=True)
    for f in fields:
        if f in data and data[f] is not None:
            updates.append(f'{f} = ?')
            params.append(data[f])
    if not updates:
        conn.close()
        raise HTTPException(status_code=400, detail='没有要更新的字段')
    params.append(item_id)
    cursor.execute(f"UPDATE closed_options SET {', '.join(updates)} WHERE id = ?", params)
    conn.commit()
    conn.close()
    return {'success': True, 'id': item_id}

@router.delete('/closed-options/{item_id}')
def delete_closed_option(item_id: int):
    _init_tables()
    conn = _get_db_connection()
    cursor = conn.cursor()
    cursor.execute('DELETE FROM closed_options WHERE id = ?', (item_id,))
    conn.commit()
    deleted = cursor.rowcount
    conn.close()
    if deleted == 0:
        raise HTTPException(status_code=404, detail='记录不存在')
    return {'success': True, 'id': item_id}
