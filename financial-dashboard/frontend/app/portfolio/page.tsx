'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import Link from 'next/link'
import {
  getPortfolio,
  addPortfolioItem,
  updatePortfolioItem,
  deletePortfolioItem,
  refreshPortfolioPrices,
  getPortfolioSummary,
  stockSearch,
  getClosedStocks,
  addClosedStock,
  updateClosedStock,
  deleteClosedStock,
  getClosedOptions,
  addClosedOption,
  updateClosedOption,
  deleteClosedOption,
  PortfolioItem,
  PortfolioSummary,
  StockSearchResult,
  ClosedStock,
  ClosedOption,
} from '@/lib/api'

const MARKET_OPTIONS = ['A股', '港股', '美股']

/** 千位分隔符格式化（固定小数位） */
function formatNumber(value: number | null, decimals = 2): string {
  if (value === null || value === undefined) return '-'
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value)
}

/** 持仓数量格式化（整数千位分隔） */
function formatShares(value: number | null): string {
  if (value === null || value === undefined) return '-'
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
}

/** 金额格式化（带千位分隔的亿/万/元） */
function formatCurrency(value: number | null, prefix = '¥'): string {
  if (value === null || value === undefined) return '-'
  if (value >= 100000000) return prefix + formatNumber(value / 100000000, 2) + '亿'
  if (value >= 10000) return prefix + formatNumber(value / 10000, 2) + '万'
  return prefix + formatNumber(value, 2)
}

function profitColor(rate: number | null): string {
  if (rate === null || rate === undefined) return 'text-gray-500'
  return rate >= 0 ? 'text-red-600' : 'text-green-600'
}

/** 计算单个标的市值（原始货币，未换算） */
function calcMarketValue(item: PortfolioItem): number | null {
  if (item.last_price !== null && item.shares !== null) {
    return item.last_price * item.shares
  }
  return null
}

/** 根据市场获取汇率（转换为人民币） */
function getMarketRate(market: string, summary: PortfolioSummary | null): number {
  if (!summary?.exchange_rates) return 1.0
  if (market === '港股') return summary.exchange_rates.HKD_CNY || 1.0
  if (market === '美股') return summary.exchange_rates.USD_CNY || 1.0
  return 1.0
}

function round2(v: number): number { return Math.round(v * 100) / 100 }

// ---------- Closed Stock Form ----------
function ClosedStockForm({ market, onAdded }: { market: string; onAdded: () => void }) {
  const [show, setShow] = useState(false)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [shares, setShares] = useState('')
  const [buyPrice, setBuyPrice] = useState('')
  const [sellPrice, setSellPrice] = useState('')
  const [buyDate, setBuyDate] = useState('')
  const [sellDate, setSellDate] = useState('')
  const [fee, setFee] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!code.trim() || !name.trim() || !shares.trim()) return
    setSaving(true)
    setErr('')
    try {
      await addClosedStock({
        code: code.trim(),
        name: name.trim(),
        market,
        shares: parseFloat(shares),
        buy_price: buyPrice ? parseFloat(buyPrice) : undefined,
        sell_price: sellPrice ? parseFloat(sellPrice) : undefined,
        buy_date: buyDate || undefined,
        sell_date: sellDate || undefined,
        fee: fee ? parseFloat(fee) : undefined,
        notes: notes || undefined,
      })
      setCode(''); setName(''); setShares(''); setBuyPrice(''); setSellPrice('')
      setBuyDate(''); setSellDate(''); setFee(''); setNotes('')
      setShow(false)
      onAdded()
    } catch (e: any) {
      setErr(e?.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  if (!show) {
    return (
      <button
        onClick={() => setShow(true)}
        className="mb-2 rounded-lg border border-dashed border-gray-300 px-3 py-1.5 text-xs text-gray-500 hover:border-blue-400 hover:text-blue-600"
      >
        + 添加已清仓股票
      </button>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="mb-3 rounded-lg border border-blue-200 bg-blue-50 p-4">
      {err && <div className="mb-2 text-xs text-red-600">{err}</div>}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <input value={code} onChange={e => setCode(e.target.value)} placeholder="股票代码" required className="rounded border border-gray-300 px-2 py-1 text-xs" />
        <input value={name} onChange={e => setName(e.target.value)} placeholder="股票名称" required className="rounded border border-gray-300 px-2 py-1 text-xs" />
        <input type="number" value={shares} onChange={e => setShares(e.target.value)} placeholder="买入数量" required className="rounded border border-gray-300 px-2 py-1 text-xs" />
        <input type="number" value={buyPrice} onChange={e => setBuyPrice(e.target.value)} placeholder="买入均价" className="rounded border border-gray-300 px-2 py-1 text-xs" />
        <input type="number" value={sellPrice} onChange={e => setSellPrice(e.target.value)} placeholder="卖出均价" className="rounded border border-gray-300 px-2 py-1 text-xs" />
        <input type="date" value={buyDate} onChange={e => setBuyDate(e.target.value)} placeholder="买入日期" className="rounded border border-gray-300 px-2 py-1 text-xs" />
        <input type="date" value={sellDate} onChange={e => setSellDate(e.target.value)} placeholder="卖出日期" className="rounded border border-gray-300 px-2 py-1 text-xs" />
        <input type="number" value={fee} onChange={e => setFee(e.target.value)} placeholder="手续费" className="rounded border border-gray-300 px-2 py-1 text-xs" />
        <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="备注" className="rounded border border-gray-300 px-2 py-1 text-xs" />
      </div>
      <div className="mt-2 flex justify-end gap-2">
        <button type="button" onClick={() => setShow(false)} className="rounded bg-gray-200 px-3 py-1 text-xs text-gray-700">取消</button>
        <button type="submit" disabled={saving} className="rounded bg-blue-600 px-3 py-1 text-xs text-white disabled:opacity-50">{saving ? '保存中...' : '保存'}</button>
      </div>
    </form>
  )
}

// ---------- Closed Option Form ----------
function ClosedOptionForm({ market, onAdded }: { market: string; onAdded: () => void }) {
  const [show, setShow] = useState(false)
  const [underlyingCode, setUnderlyingCode] = useState('')
  const [contractCode, setContractCode] = useState('')
  const [direction, setDirection] = useState('Sell Put')
  const [strikePrice, setStrikePrice] = useState('')
  const [contracts, setContracts] = useState('')
  const [multiplier, setMultiplier] = useState('100')
  const [openPremium, setOpenPremium] = useState('')
  const [closePremium, setClosePremium] = useState('')
  const [openDate, setOpenDate] = useState('')
  const [closeDate, setCloseDate] = useState('')
  const [fee, setFee] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!underlyingCode.trim() || !contractCode.trim() || !contracts.trim()) return
    setSaving(true)
    setErr('')
    try {
      await addClosedOption({
        underlying_code: underlyingCode.trim(),
        contract_code: contractCode.trim(),
        market,
        direction: direction || undefined,
        strike_price: strikePrice ? parseFloat(strikePrice) : undefined,
        contracts: parseFloat(contracts),
        multiplier: multiplier ? parseFloat(multiplier) : 100,
        open_premium: openPremium ? parseFloat(openPremium) : undefined,
        close_premium: closePremium ? parseFloat(closePremium) : undefined,
        open_date: openDate || undefined,
        close_date: closeDate || undefined,
        fee: fee ? parseFloat(fee) : undefined,
        notes: notes || undefined,
      })
      setUnderlyingCode(''); setContractCode(''); setContracts(''); setStrikePrice('')
      setOpenPremium(''); setClosePremium(''); setOpenDate(''); setCloseDate(''); setFee(''); setNotes('')
      setShow(false)
      onAdded()
    } catch (e: any) {
      setErr(e?.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  if (!show) {
    return (
      <button
        onClick={() => setShow(true)}
        className="mb-2 rounded-lg border border-dashed border-gray-300 px-3 py-1.5 text-xs text-gray-500 hover:border-blue-400 hover:text-blue-600"
      >
        + 添加已清仓期权
      </button>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="mb-3 rounded-lg border border-purple-200 bg-purple-50 p-4">
      {err && <div className="mb-2 text-xs text-red-600">{err}</div>}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <input value={underlyingCode} onChange={e => setUnderlyingCode(e.target.value)} placeholder="标的代码" required className="rounded border border-gray-300 px-2 py-1 text-xs" />
        <input value={contractCode} onChange={e => setContractCode(e.target.value)} placeholder="合约代码" required className="rounded border border-gray-300 px-2 py-1 text-xs" />
        <select value={direction} onChange={e => setDirection(e.target.value)} className="rounded border border-gray-300 px-2 py-1 text-xs">
          <option value="Sell Put">Sell Put</option>
          <option value="Sell Call">Sell Call</option>
          <option value="Buy Put">Buy Put</option>
          <option value="Buy Call">Buy Call</option>
        </select>
        <input type="number" value={strikePrice} onChange={e => setStrikePrice(e.target.value)} placeholder="行权价格" className="rounded border border-gray-300 px-2 py-1 text-xs" />
        <input type="number" value={contracts} onChange={e => setContracts(e.target.value)} placeholder="合约数量" required className="rounded border border-gray-300 px-2 py-1 text-xs" />
        <input type="number" value={multiplier} onChange={e => setMultiplier(e.target.value)} placeholder="合约乘数" className="rounded border border-gray-300 px-2 py-1 text-xs" />
        <input type="number" value={openPremium} onChange={e => setOpenPremium(e.target.value)} placeholder="开仓权利金/股" className="rounded border border-gray-300 px-2 py-1 text-xs" />
        <input type="number" value={closePremium} onChange={e => setClosePremium(e.target.value)} placeholder="平仓权利金/股" className="rounded border border-gray-300 px-2 py-1 text-xs" />
        <input type="date" value={openDate} onChange={e => setOpenDate(e.target.value)} className="rounded border border-gray-300 px-2 py-1 text-xs" />
        <input type="date" value={closeDate} onChange={e => setCloseDate(e.target.value)} className="rounded border border-gray-300 px-2 py-1 text-xs" />
        <input type="number" value={fee} onChange={e => setFee(e.target.value)} placeholder="手续费" className="rounded border border-gray-300 px-2 py-1 text-xs" />
        <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="备注" className="rounded border border-gray-300 px-2 py-1 text-xs" />
      </div>
      <div className="mt-2 flex justify-end gap-2">
        <button type="button" onClick={() => setShow(false)} className="rounded bg-gray-200 px-3 py-1 text-xs text-gray-700">取消</button>
        <button type="submit" disabled={saving} className="rounded bg-purple-600 px-3 py-1 text-xs text-white disabled:opacity-50">{saving ? '保存中...' : '保存'}</button>
      </div>
    </form>
  )
}

// ---------- Editable Cell ----------
function EditCell({ value, onChange, type = 'text', placeholder }: { value: string; onChange: (v: string) => void; type?: string; placeholder?: string }) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-20 rounded border border-gray-300 px-1 py-0.5 text-right text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
    />
  )
}

// ---------- Closed Stock Table ----------
function ClosedStockTable({ items, onDelete, onUpdate }: { items: ClosedStock[]; onDelete: (id: number) => void; onUpdate: (id: number, data: any) => Promise<void> }) {
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editData, setEditData] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const startEdit = (item: ClosedStock) => {
    setEditingId(item.id)
    setEditData({
      code: item.code || '',
      name: item.name || '',
      shares: String(item.shares ?? ''),
      buy_price: item.buy_price !== null ? String(item.buy_price) : '',
      sell_price: item.sell_price !== null ? String(item.sell_price) : '',
      buy_date: item.buy_date || '',
      sell_date: item.sell_date || '',
      fee: item.fee !== null ? String(item.fee) : '',
      notes: item.notes || '',
    })
  }

  const cancelEdit = () => { setEditingId(null); setEditData({}) }

  const saveEdit = async (id: number) => {
    setSaving(true)
    try {
      const payload: any = {}
      for (const [k, v] of Object.entries(editData)) {
        if (v !== '') {
          if (k === 'shares' || k === 'buy_price' || k === 'sell_price' || k === 'fee') {
            payload[k] = parseFloat(v)
          } else {
            payload[k] = v
          }
        }
      }
      await onUpdate(id, payload)
      cancelEdit()
    } finally {
      setSaving(false)
    }
  }

  if (items.length === 0) {
    return <div className="px-4 py-6 text-center text-xs text-gray-400">暂无已清仓股票记录</div>
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 sticky top-0">
          <tr>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">代码</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">名称</th>
            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">买入日期</th>
            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">卖出日期</th>
            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">数量</th>
            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">买入均价</th>
            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">卖出均价</th>
            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">买入总额</th>
            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">卖出总额</th>
            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">手续费</th>
            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">盈亏</th>
            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">收益率</th>
            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">持有天数</th>
            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">年化</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">备注</th>
            <th className="px-3 py-2 text-center text-xs font-medium text-gray-500">操作</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {items.map(item => {
            const isEditing = editingId === item.id
            return (
              <tr key={item.id} className="hover:bg-gray-50">
                <td className="whitespace-nowrap px-3 py-2 text-xs font-medium text-gray-900">
                  {isEditing ? <EditCell value={editData.code || ''} onChange={v => setEditData({...editData, code: v})} /> : item.code}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-700">
                  {isEditing ? <EditCell value={editData.name || ''} onChange={v => setEditData({...editData, name: v})} /> : item.name}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right text-xs text-gray-500">
                  {isEditing ? <input type="date" value={editData.buy_date || ''} onChange={e => setEditData({...editData, buy_date: e.target.value})} className="rounded border border-gray-300 px-1 py-0.5 text-xs" /> : (item.buy_date || '-')}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right text-xs text-gray-500">
                  {isEditing ? <input type="date" value={editData.sell_date || ''} onChange={e => setEditData({...editData, sell_date: e.target.value})} className="rounded border border-gray-300 px-1 py-0.5 text-xs" /> : (item.sell_date || '-')}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right text-xs text-gray-900">
                  {isEditing ? <EditCell value={editData.shares || ''} onChange={v => setEditData({...editData, shares: v})} type="number" /> : formatShares(item.shares)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right text-xs text-gray-900">
                  {isEditing ? <EditCell value={editData.buy_price || ''} onChange={v => setEditData({...editData, buy_price: v})} type="number" /> : (item.buy_price !== null ? formatNumber(item.buy_price) : '-')}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right text-xs text-gray-900">
                  {isEditing ? <EditCell value={editData.sell_price || ''} onChange={v => setEditData({...editData, sell_price: v})} type="number" /> : (item.sell_price !== null ? formatNumber(item.sell_price) : '-')}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right text-xs text-gray-900">{item.buy_total !== null ? formatNumber(item.buy_total) : '-'}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right text-xs text-gray-900">{item.sell_total !== null ? formatNumber(item.sell_total) : '-'}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right text-xs text-gray-900">
                  {isEditing ? <EditCell value={editData.fee || ''} onChange={v => setEditData({...editData, fee: v})} type="number" /> : (item.fee !== null && item.fee !== 0 ? formatNumber(item.fee) : '-')}
                </td>
                <td className={`whitespace-nowrap px-3 py-2 text-right text-xs font-semibold ${profitColor(item.profit)}`}>
                  {item.profit !== null ? (item.profit >= 0 ? '+' : '') + formatNumber(item.profit) : '-'}
                </td>
                <td className={`whitespace-nowrap px-3 py-2 text-right text-xs font-semibold ${profitColor(item.profit_rate)}`}>
                  {item.profit_rate !== null ? (item.profit_rate >= 0 ? '+' : '') + formatNumber(item.profit_rate) + '%' : '-'}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right text-xs text-gray-500">{item.holding_days !== null ? item.holding_days + '天' : '-'}</td>
                <td className={`whitespace-nowrap px-3 py-2 text-right text-xs ${profitColor(item.annualized)}`}>
                  {item.annualized !== null ? (item.annualized >= 0 ? '+' : '') + formatNumber(item.annualized) + '%' : '-'}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-left text-xs text-gray-700">
                  {isEditing ? <EditCell value={editData.notes || ''} onChange={v => setEditData({...editData, notes: v})} placeholder="备注" /> : (item.notes || '-')}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-center text-xs">
                  {isEditing ? (
                    <div className="flex items-center justify-center gap-1">
                      <button onClick={() => saveEdit(item.id)} disabled={saving} className="rounded bg-blue-600 px-1.5 py-0.5 text-xs text-white hover:bg-blue-700 disabled:opacity-50">{saving ? '...' : '保存'}</button>
                      <button onClick={cancelEdit} className="rounded bg-gray-200 px-1.5 py-0.5 text-xs text-gray-700 hover:bg-gray-300">取消</button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center gap-2">
                      <button onClick={() => startEdit(item)} className="text-blue-600 hover:underline">编辑</button>
                      <button onClick={() => onDelete(item.id)} className="text-red-600 hover:underline">删除</button>
                    </div>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ---------- Closed Option Table ----------
function ClosedOptionTable({ items, onDelete, onUpdate }: { items: ClosedOption[]; onDelete: (id: number) => void; onUpdate: (id: number, data: any) => Promise<void> }) {
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editData, setEditData] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const startEdit = (item: ClosedOption) => {
    setEditingId(item.id)
    setEditData({
      underlying_code: item.underlying_code || '',
      contract_code: item.contract_code || '',
      direction: item.direction || '',
      strike_price: item.strike_price !== null ? String(item.strike_price) : '',
      contracts: String(item.contracts ?? ''),
      multiplier: String(item.multiplier ?? '100'),
      open_premium: item.open_premium !== null ? String(item.open_premium) : '',
      close_premium: item.close_premium !== null ? String(item.close_premium) : '',
      open_date: item.open_date || '',
      close_date: item.close_date || '',
      fee: item.fee !== null ? String(item.fee) : '',
      notes: item.notes || '',
    })
  }

  const cancelEdit = () => { setEditingId(null); setEditData({}) }

  const saveEdit = async (id: number) => {
    setSaving(true)
    try {
      const payload: any = {}
      for (const [k, v] of Object.entries(editData)) {
        if (v !== '') {
          if (k === 'strike_price' || k === 'contracts' || k === 'multiplier' || k === 'open_premium' || k === 'close_premium' || k === 'fee') {
            payload[k] = parseFloat(v)
          } else {
            payload[k] = v
          }
        }
      }
      await onUpdate(id, payload)
      cancelEdit()
    } finally {
      setSaving(false)
    }
  }

  if (items.length === 0) {
    return <div className="px-4 py-6 text-center text-xs text-gray-400">暂无已清仓期权记录</div>
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 sticky top-0">
          <tr>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">标的代码</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">合约代码</th>
            <th className="px-3 py-2 text-center text-xs font-medium text-gray-500">方向</th>
            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">行权价</th>
            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">开仓日</th>
            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">平仓日</th>
            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">合约数</th>
            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">乘数</th>
            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">开仓权利金/股</th>
            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">平仓权利金/股</th>
            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">开仓总额</th>
            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">平仓总额</th>
            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">手续费</th>
            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">净权利金盈亏</th>
            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">保证金</th>
            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">收益率</th>
            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">持有天数</th>
            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">年化</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">备注</th>
            <th className="px-3 py-2 text-center text-xs font-medium text-gray-500">操作</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {items.map(item => {
            const isEditing = editingId === item.id
            return (
              <tr key={item.id} className="hover:bg-gray-50">
                <td className="whitespace-nowrap px-3 py-2 text-xs font-medium text-gray-900">
                  {isEditing ? <EditCell value={editData.underlying_code || ''} onChange={v => setEditData({...editData, underlying_code: v})} /> : item.underlying_code}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-700">
                  {isEditing ? <EditCell value={editData.contract_code || ''} onChange={v => setEditData({...editData, contract_code: v})} /> : item.contract_code}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-center text-xs text-gray-700">
                  {isEditing ? (
                    <select value={editData.direction || ''} onChange={e => setEditData({...editData, direction: e.target.value})} className="rounded border border-gray-300 px-1 py-0.5 text-xs">
                      <option value="">-</option>
                      <option value="Sell Put">Sell Put</option>
                      <option value="Sell Call">Sell Call</option>
                      <option value="Buy Put">Buy Put</option>
                      <option value="Buy Call">Buy Call</option>
                    </select>
                  ) : (item.direction || '-')}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right text-xs text-gray-900">
                  {isEditing ? <EditCell value={editData.strike_price || ''} onChange={v => setEditData({...editData, strike_price: v})} type="number" /> : (item.strike_price !== null ? formatNumber(item.strike_price) : '-')}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right text-xs text-gray-500">
                  {isEditing ? <input type="date" value={editData.open_date || ''} onChange={e => setEditData({...editData, open_date: e.target.value})} className="rounded border border-gray-300 px-1 py-0.5 text-xs" /> : (item.open_date || '-')}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right text-xs text-gray-500">
                  {isEditing ? <input type="date" value={editData.close_date || ''} onChange={e => setEditData({...editData, close_date: e.target.value})} className="rounded border border-gray-300 px-1 py-0.5 text-xs" /> : (item.close_date || '-')}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right text-xs text-gray-900">
                  {isEditing ? <EditCell value={editData.contracts || ''} onChange={v => setEditData({...editData, contracts: v})} type="number" /> : formatShares(item.contracts)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right text-xs text-gray-500">
                  {isEditing ? <EditCell value={editData.multiplier || ''} onChange={v => setEditData({...editData, multiplier: v})} type="number" /> : item.multiplier}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right text-xs text-gray-900">
                  {isEditing ? <EditCell value={editData.open_premium || ''} onChange={v => setEditData({...editData, open_premium: v})} type="number" /> : (item.open_premium !== null ? formatNumber(item.open_premium) : '-')}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right text-xs text-gray-900">
                  {isEditing ? <EditCell value={editData.close_premium || ''} onChange={v => setEditData({...editData, close_premium: v})} type="number" /> : (item.close_premium !== null ? formatNumber(item.close_premium) : '-')}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right text-xs text-gray-900">{item.open_total !== null ? formatNumber(item.open_total) : '-'}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right text-xs text-gray-900">{item.close_total !== null ? formatNumber(item.close_total) : '-'}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right text-xs text-gray-900">
                  {isEditing ? <EditCell value={editData.fee || ''} onChange={v => setEditData({...editData, fee: v})} type="number" /> : (item.fee !== null && item.fee !== 0 ? formatNumber(item.fee) : '-')}
                </td>
                <td className={`whitespace-nowrap px-3 py-2 text-right text-xs font-semibold ${profitColor(item.net_premium)}`}>
                  {item.net_premium !== null ? (item.net_premium >= 0 ? '+' : '') + formatNumber(item.net_premium) : '-'}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right text-xs text-gray-500">{item.margin !== null ? formatNumber(item.margin) : '-'}</td>
                <td className={`whitespace-nowrap px-3 py-2 text-right text-xs font-semibold ${profitColor(item.profit_rate)}`}>
                  {item.profit_rate !== null ? (item.profit_rate >= 0 ? '+' : '') + formatNumber(item.profit_rate) + '%' : '-'}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right text-xs text-gray-500">{item.holding_days !== null ? item.holding_days + '天' : '-'}</td>
                <td className={`whitespace-nowrap px-3 py-2 text-right text-xs ${profitColor(item.annualized)}`}>
                  {item.annualized !== null ? (item.annualized >= 0 ? '+' : '') + formatNumber(item.annualized) + '%' : '-'}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-left text-xs text-gray-700">
                  {isEditing ? <EditCell value={editData.notes || ''} onChange={v => setEditData({...editData, notes: v})} placeholder="备注" /> : (item.notes || '-')}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-center text-xs">
                  {isEditing ? (
                    <div className="flex items-center justify-center gap-1">
                      <button onClick={() => saveEdit(item.id)} disabled={saving} className="rounded bg-blue-600 px-1.5 py-0.5 text-xs text-white hover:bg-blue-700 disabled:opacity-50">{saving ? '...' : '保存'}</button>
                      <button onClick={cancelEdit} className="rounded bg-gray-200 px-1.5 py-0.5 text-xs text-gray-700 hover:bg-gray-300">取消</button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center gap-2">
                      <button onClick={() => startEdit(item)} className="text-blue-600 hover:underline">编辑</button>
                      <button onClick={() => onDelete(item.id)} className="text-red-600 hover:underline">删除</button>
                    </div>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function PortfolioPage() {
  const [summary, setSummary] = useState<PortfolioSummary | null>(null)
  const [items, setItems] = useState<PortfolioItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  // 已清仓数据
  const [closedStocks, setClosedStocks] = useState<ClosedStock[]>([])
  const [closedOptions, setClosedOptions] = useState<ClosedOption[]>([])

  // 添加表单
  const [showAddForm, setShowAddForm] = useState(false)
  const [newCode, setNewCode] = useState('')
  const [newName, setNewName] = useState('')
  const [newMarket, setNewMarket] = useState('A股')
  const [newShares, setNewShares] = useState('')
  const [newCost, setNewCost] = useState('')
  const [newFee, setNewFee] = useState('')
  const [newNotes, setNewNotes] = useState('')
  const [adding, setAdding] = useState(false)

  // 搜索联想
  const [searchResults, setSearchResults] = useState<StockSearchResult[]>([])
  const [showSearchDropdown, setShowSearchDropdown] = useState(false)
  const [searchLoading, setSearchLoading] = useState(false)
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // 行内编辑状态（持仓）
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editShares, setEditShares] = useState('')
  const [editCost, setEditCost] = useState('')
  const [editFee, setEditFee] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  const loadData = async () => {
    setLoading(true)
    setError('')
    try {
      const [sum, list, cs, co] = await Promise.all([
        getPortfolioSummary().catch(() => null),
        getPortfolio().catch(() => []),
        getClosedStocks().catch(() => []),
        getClosedOptions().catch(() => []),
      ])
      setSummary(sum)
      setItems(list)
      setClosedStocks(cs)
      setClosedOptions(co)
    } catch (err) {
      console.error('加载数据失败:', err)
      setError('数据加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  // 点击外部关闭搜索下拉
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowSearchDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSearch = useCallback((query: string) => {
    setNewCode(query)
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    if (!query.trim() || query.trim().length < 1) {
      setSearchResults([])
      setShowSearchDropdown(false)
      return
    }
    setSearchLoading(true)
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const results = await stockSearch(query.trim())
        setSearchResults(results.slice(0, 2))
        setShowSearchDropdown(results.length > 0)
      } catch (e) {
        setSearchResults([])
      } finally {
        setSearchLoading(false)
      }
    }, 300)
  }, [])

  const handleCodeBlur = useCallback(async () => {
    setTimeout(async () => {
      if (!newCode.trim() || newName.trim()) return
      try {
        const results = await stockSearch(newCode.trim())
        if (results.length > 0) {
          const exact = results.find(r => r.code === newCode.trim() || r.code.split('.')[0] === newCode.trim())
          const result = exact || results[0]
          setNewName(result.name)
          const mt = result.market_type
          if (mt === '港股') setNewMarket('港股')
          else if (mt === '美股') setNewMarket('美股')
          else setNewMarket('A股')
        }
      } catch (e) {}
    }, 200)
  }, [newCode, newName])

  const selectSearchResult = (result: StockSearchResult) => {
    setNewCode(result.code)
    setNewName(result.name)
    const mt = result.market_type
    if (mt === '港股') setNewMarket('港股')
    else if (mt === '美股') setNewMarket('美股')
    else setNewMarket('A股')
    setShowSearchDropdown(false)
    setSearchResults([])
  }

  const handleRefreshPrices = async () => {
    setRefreshing(true)
    try {
      await refreshPortfolioPrices()
      await loadData()
    } catch (err) {
      console.error('刷新股价失败:', err)
      setError('刷新股价失败')
    } finally {
      setRefreshing(false)
    }
  }

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newCode.trim() || !newName.trim() || !newShares.trim()) return
    setAdding(true)
    try {
      await addPortfolioItem({
        code: newCode.trim(),
        name: newName.trim(),
        market: newMarket,
        shares: parseFloat(newShares),
        avg_cost: newCost ? parseFloat(newCost) : undefined,
        fee: newFee ? parseFloat(newFee) : undefined,
        notes: newNotes || undefined,
      })
      setNewCode(''); setNewName(''); setNewShares(''); setNewCost(''); setNewFee(''); setNewNotes('')
      setShowAddForm(false); setShowSearchDropdown(false)
      await loadData()
    } catch (err: any) {
      setError('添加失败: ' + (err?.message || String(err)))
    } finally {
      setAdding(false)
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除这条持仓记录？')) return
    try { await deletePortfolioItem(id); await loadData() } catch { setError('删除失败') }
  }

  const handleEditStart = (item: PortfolioItem) => {
    setEditingId(item.id)
    setEditShares(item.shares !== null ? String(item.shares) : '')
    setEditCost(item.avg_cost !== null ? String(item.avg_cost) : '')
    setEditFee(item.fee !== null ? String(item.fee) : '')
    setEditNotes(item.notes || '')
  }

  const handleEditCancel = () => {
    setEditingId(null); setEditShares(''); setEditCost(''); setEditFee(''); setEditNotes('')
  }

  const handleEditSave = async (id: number) => {
    const sharesNum = parseFloat(editShares)
    const costNum = editCost ? parseFloat(editCost) : undefined
    const feeNum = editFee ? parseFloat(editFee) : undefined
    if (isNaN(sharesNum) || sharesNum < 0) { setError('持仓数量必须为非负数'); return }
    if (editCost && (isNaN(costNum!) || costNum! < 0)) { setError('平均成本必须为非负数'); return }
    setSavingEdit(true)
    try {
      const payload: { shares?: number; avg_cost?: number; fee?: number; notes?: string } = { shares: sharesNum }
      if (editCost) payload.avg_cost = costNum
      if (editFee) payload.fee = feeNum
      if (editNotes !== undefined) payload.notes = editNotes
      await updatePortfolioItem(id, payload)
      setEditingId(null)
      await loadData()
    } catch (err: any) {
      setError('保存失败: ' + (err?.message || String(err)))
    } finally {
      setSavingEdit(false)
    }
  }

  // 按市场分组，并按市值降序排列（使用人民币换算后的市值）
  const grouped: Record<string, PortfolioItem[]> = {}
  items.forEach((item) => {
    if (!grouped[item.market]) grouped[item.market] = []
    grouped[item.market].push(item)
  })
  Object.values(grouped).forEach((list) => {
    list.sort((a, b) => {
      const rateA = getMarketRate(a.market, summary)
      const rateB = getMarketRate(b.market, summary)
      const mvA = (calcMarketValue(a) ?? -Infinity) * rateA
      const mvB = (calcMarketValue(b) ?? -Infinity) * rateB
      return mvB - mvA
    })
  })

  // 已清仓股票按市场分组
  const closedStocksByMarket: Record<string, ClosedStock[]> = { 'A股': [], '港股': [], '美股': [] }
  closedStocks.forEach(s => {
    if (!closedStocksByMarket[s.market]) closedStocksByMarket[s.market] = []
    closedStocksByMarket[s.market].push(s)
  })

  // 已清仓期权按市场分组（仅美股、港股）
  const closedOptionsByMarket: Record<string, ClosedOption[]> = { '美股': [], '港股': [] }
  closedOptions.forEach(o => {
    if (!closedOptionsByMarket[o.market]) closedOptionsByMarket[o.market] = []
    closedOptionsByMarket[o.market].push(o)
  })

  // 计算已清仓统计
  const calcStockSummary = (stocks: ClosedStock[]) => {
    const cost = stocks.reduce((s, i) => s + (i.buy_total || 0), 0)
    const profit = stocks.reduce((s, i) => s + (i.profit || 0), 0)
    const profitRate = cost > 0 ? (profit / cost * 100) : null
    return { cost: round2(cost), profit: round2(profit), profitRate: profitRate !== null ? round2(profitRate) : null }
  }

  const calcOptionSummary = (options: ClosedOption[]) => {
    const margin = options.reduce((s, i) => s + (i.margin || 0), 0)
    const netPremium = options.reduce((s, i) => s + (i.net_premium || 0), 0)
    const profitRate = margin > 0 ? (netPremium / margin * 100) : null
    return { cost: round2(margin), profit: round2(netPremium), profitRate: profitRate !== null ? round2(profitRate) : null }
  }

  // 清仓总览：所有已清仓股票+期权的合计
  const closedTotalCost = closedStocks.reduce((s, i) => s + (i.buy_total || 0), 0) + closedOptions.reduce((s, i) => s + (i.margin || 0), 0)
  const closedTotalProfit = closedStocks.reduce((s, i) => s + (i.profit || 0), 0) + closedOptions.reduce((s, i) => s + (i.net_premium || 0), 0)
  const closedTotalProfitRate = closedTotalCost > 0 ? (closedTotalProfit / closedTotalCost * 100) : null

  const handleDeleteClosedStock = async (id: number) => {
    if (!confirm('确定删除这条已清仓股票记录？')) return
    try { await deleteClosedStock(id); await loadData() } catch { setError('删除失败') }
  }

  const handleDeleteClosedOption = async (id: number) => {
    if (!confirm('确定删除这条已清仓期权记录？')) return
    try { await deleteClosedOption(id); await loadData() } catch { setError('删除失败') }
  }

  const handleUpdateClosedStock = async (id: number, data: any) => {
    try { await updateClosedStock(id, data); await loadData() } catch (e: any) { setError('更新失败: ' + (e?.message || String(e))) }
  }

  const handleUpdateClosedOption = async (id: number, data: any) => {
    try { await updateClosedOption(id, data); await loadData() } catch (e: any) { setError('更新失败: ' + (e?.message || String(e))) }
  }

  const marketOrder = ['A股', '港股', '美股']

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-6xl px-6 py-8">
        {/* 导航栏 */}
        <div className="mb-6 flex items-center justify-between">
          <Link href="/" className="text-blue-600 hover:underline">← 返回首页</Link>
          <div className="flex gap-3">
            <button onClick={handleRefreshPrices} disabled={refreshing}
              className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-green-700 disabled:opacity-50">
              {refreshing ? '刷新中...' : '刷新股价'}
            </button>
            <button onClick={() => setShowAddForm(!showAddForm)}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-blue-700">
              {showAddForm ? '取消' : '添加持仓'}
            </button>
          </div>
        </div>

        <header className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">我的资产</h1>
          <p className="mt-1 text-sm text-gray-500">
            根据最新实时价格计算持仓市值 · 支持 A股/港股/美股
          </p>
        </header>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        {/* ===== 持仓部分总览 ===== */}
        <div className="mb-4">
          <h2 className="mb-3 text-lg font-bold text-gray-800">持仓</h2>
          {summary && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
              <div className="rounded-lg bg-white p-5 shadow">
                <div className="text-sm text-gray-500">总资产（人民币）</div>
                <div className="mt-1 text-2xl font-bold text-gray-900">{formatCurrency(summary.grand_total)}</div>
              </div>
              <div className="rounded-lg bg-white p-5 shadow">
                <div className="text-sm text-gray-500">总成本（人民币）</div>
                <div className="mt-1 text-2xl font-bold text-gray-900">{formatCurrency(summary.grand_cost)}</div>
              </div>
              <div className="rounded-lg bg-white p-5 shadow">
                <div className="text-sm text-gray-500">总盈亏</div>
                <div className={`mt-1 text-2xl font-bold ${profitColor(summary.grand_profit_rate)}`}>
                  {formatCurrency(summary.grand_profit)}
                </div>
              </div>
              <div className="rounded-lg bg-white p-5 shadow">
                <div className="text-sm text-gray-500">收益率</div>
                <div className={`mt-1 text-2xl font-bold ${profitColor(summary.grand_profit_rate)}`}>
                  {summary.grand_profit_rate !== null && summary.grand_profit_rate !== undefined
                    ? (summary.grand_profit_rate >= 0 ? '+' : '') + formatNumber(summary.grand_profit_rate, 2) + '%'
                    : '-'}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ===== 清仓部分总览 ===== */}
        <div className="mb-6">
          <h2 className="mb-3 text-lg font-bold text-gray-800">清仓</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <div className="rounded-lg bg-white p-5 shadow">
              <div className="text-sm text-gray-500">总成本（人民币）</div>
              <div className="mt-1 text-2xl font-bold text-gray-900">
                {closedTotalCost > 0 ? formatCurrency(round2(closedTotalCost)) : '-'}
              </div>
            </div>
            <div className="rounded-lg bg-white p-5 shadow">
              <div className="text-sm text-gray-500">总盈亏</div>
              <div className={`mt-1 text-2xl font-bold ${profitColor(closedTotalProfitRate)}`}>
                {closedTotalCost > 0 ? (closedTotalProfit >= 0 ? '+' : '') + formatCurrency(round2(closedTotalProfit)) : '-'}
              </div>
            </div>
            <div className="rounded-lg bg-white p-5 shadow">
              <div className="text-sm text-gray-500">收益率</div>
              <div className={`mt-1 text-2xl font-bold ${profitColor(closedTotalProfitRate)}`}>
                {closedTotalProfitRate !== null ? (closedTotalProfitRate >= 0 ? '+' : '') + formatNumber(closedTotalProfitRate, 2) + '%' : '-'}
              </div>
            </div>
            <div className="rounded-lg bg-white p-5 shadow">
              <div className="text-sm text-gray-500">记录数</div>
              <div className="mt-1 text-2xl font-bold text-gray-900">
                {closedStocks.length + closedOptions.length} 条
                <span className="ml-2 text-sm font-normal text-gray-400">
                  (股票{closedStocks.length} + 期权{closedOptions.length})
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* 汇率信息 */}
        {summary?.exchange_rates && (
          <div className="mb-6 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">
            <span className="font-medium">汇率参考（已用于资产换算）：</span>
            <span className="ml-2">1 USD = {summary.exchange_rates.USD_CNY} CNY</span>
            <span className="ml-3">1 HKD = {summary.exchange_rates.HKD_CNY} CNY</span>
            <span className="ml-3 text-blue-500">更新于 {summary.exchange_rates.updated_at}</span>
          </div>
        )}

        {/* 添加表单 — 始终在导航和总览之后渲染，不依赖 items 是否为空 */}
        {showAddForm && (
          <div className="mb-8 rounded-lg border border-blue-200 bg-blue-50 p-6">
            <h2 className="mb-4 text-lg font-semibold text-gray-900">添加持仓</h2>
            <form onSubmit={handleAdd} className="grid grid-cols-1 gap-4 md:grid-cols-6">
              <div className="relative md:col-span-2" ref={dropdownRef}>
                <label className="mb-1 block text-sm font-medium text-gray-700">股票代码或名称</label>
                <input type="text" value={newCode} onChange={(e) => handleSearch(e.target.value)} onBlur={handleCodeBlur}
                  placeholder="输入代码或名称，如 600519 或 茅台" required autoComplete="off"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
                {showSearchDropdown && searchResults.length > 0 && (
                  <div className="absolute z-20 mt-1 w-full rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                    {searchResults.map((result, idx) => (
                      <button key={idx} type="button" onClick={() => selectSearchResult(result)}
                        className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-blue-50">
                        <span><span className="font-semibold text-gray-900">{result.name}</span><span className="ml-2 text-gray-500">{result.code}</span></span>
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{result.market_type}</span>
                      </button>
                    ))}
                  </div>
                )}
                {searchLoading && <div className="absolute right-3 top-8 text-xs text-gray-400">搜索中...</div>}
                <p className="mt-1 text-xs text-gray-500">A股可省略后缀（如 600519 自动识别为沪市），港股/美股建议带后缀</p>
              </div>
              <div className="md:col-span-1">
                <label className="mb-1 block text-sm font-medium text-gray-700">股票名称</label>
                <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="如: 贵州茅台" required
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
              </div>
              <div className="md:col-span-1">
                <label className="mb-1 block text-sm font-medium text-gray-700">市场</label>
                <select value={newMarket} onChange={(e) => setNewMarket(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500">
                  {MARKET_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div className="md:col-span-1">
                <label className="mb-1 block text-sm font-medium text-gray-700">持仓数量</label>
                <input type="number" value={newShares} onChange={(e) => setNewShares(e.target.value)} placeholder="100" required min="0" step="1"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
              </div>
              <div className="md:col-span-1">
                <label className="mb-1 block text-sm font-medium text-gray-700">平均成本</label>
                <input type="number" value={newCost} onChange={(e) => setNewCost(e.target.value)} placeholder="可选" min="0" step="0.01"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
              </div>
              <div className="md:col-span-1">
                <label className="mb-1 block text-sm font-medium text-gray-700">手续费</label>
                <input type="number" value={newFee} onChange={(e) => setNewFee(e.target.value)} placeholder="可选" min="0" step="0.01"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-sm font-medium text-gray-700">备注</label>
                <input type="text" value={newNotes} onChange={(e) => setNewNotes(e.target.value)} placeholder="可选"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
              </div>
              <div className="md:col-span-6 flex justify-end">
                <button type="submit" disabled={adding}
                  className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white shadow hover:bg-blue-700 disabled:opacity-50">
                  {adding ? '添加中...' : '确认添加'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ===== 持仓表格 ===== */}
        {loading ? (
          <div className="py-20 text-center text-gray-500">加载中...</div>
        ) : (
          <div className="space-y-4">
            {/* 持仓表格 — 按市场分组 */}
            {items.length === 0 ? (
              <div className="rounded-lg bg-white p-10 text-center text-gray-500 shadow">
                暂无持仓记录，点击右上角「添加持仓」开始配置
              </div>
            ) : (
              marketOrder.map(market => {
                const marketItems = grouped[market] || []
                const marketSummary = summary?.markets?.[market]

                if (marketItems.length === 0) return null

                return (
                  <div key={market} className="rounded-lg bg-white shadow">
                    <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
                      <h2 className="text-lg font-bold text-gray-900">{market} 持仓</h2>
                      {marketSummary && (
                        <div className="flex gap-4 text-sm">
                          <span className="text-gray-500">市值: <span className="font-semibold text-gray-900">{formatCurrency(marketSummary.total_market_value)}</span></span>
                          <span className="text-gray-500">成本: <span className="font-semibold text-gray-900">{formatCurrency(marketSummary.total_cost)}</span></span>
                          <span className="text-gray-500">盈亏: <span className={`font-semibold ${profitColor(marketSummary.profit_rate)}`}>{' '}{formatCurrency(marketSummary.total_profit)}</span></span>
                          <span className={`font-semibold ${profitColor(marketSummary.profit_rate)}`}>
                            {marketSummary.profit_rate !== null && marketSummary.profit_rate !== undefined
                              ? (marketSummary.profit_rate >= 0 ? '+' : '') + formatNumber(marketSummary.profit_rate, 2) + '%' : ''}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">代码</th>
                            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">名称</th>
                            <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">持仓数量</th>
                            <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">平均成本</th>
                            <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">最新价</th>
                            <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">市值</th>
                            <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">手续费</th>
                            <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">盈亏</th>
                            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">备注</th>
                            <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-gray-500">操作</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                          {marketItems.map((item) => {
                            const isEditing = editingId === item.id
                            const rate = getMarketRate(item.market, summary)
                            const marketValueRaw = calcMarketValue(item)
                            const costValueRaw = item.avg_cost !== null && item.shares !== null ? item.avg_cost * item.shares : null
                            const feeValue = (item.fee || 0) * rate
                            const marketValue = marketValueRaw !== null ? marketValueRaw * rate : null
                            const costValue = costValueRaw !== null ? costValueRaw * rate : null
                            const profit = marketValue !== null && costValue !== null ? marketValue - costValue - feeValue : null
                            const profitRate = profit !== null && costValue !== null && costValue > 0 ? (profit / costValue) * 100 : null
                            return (
                              <tr key={item.id} className="hover:bg-gray-50">
                                <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">{item.code}</td>
                                <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">{item.name}</td>
                                <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-gray-900">
                                  {isEditing ? (
                                    <input type="number" value={editShares} onChange={(e) => setEditShares(e.target.value)} min="0" step="1" autoFocus
                                      className="w-24 rounded border border-gray-300 px-2 py-1 text-right text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
                                  ) : formatShares(item.shares)}
                                </td>
                                <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-gray-900">
                                  {isEditing ? (
                                    <input type="number" value={editCost} onChange={(e) => setEditCost(e.target.value)} min="0" step="0.01"
                                      className="w-24 rounded border border-gray-300 px-2 py-1 text-right text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
                                  ) : (item.avg_cost !== null ? formatNumber(item.avg_cost, 2) : '-')}
                                </td>
                                <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-gray-900">
                                  {item.last_price !== null ? (
                                    <span>{formatNumber(item.last_price, 2)}<span className="ml-1 text-xs text-gray-400">({item.last_price_date})</span></span>
                                  ) : '-'}
                                </td>
                                <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-semibold text-gray-900">
                                  {marketValue !== null ? formatNumber(marketValue, 2) : '-'}
                                </td>
                                <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-gray-900">
                                  {isEditing ? (
                                    <input type="number" value={editFee} onChange={(e) => setEditFee(e.target.value)} min="0" step="0.01"
                                      className="w-24 rounded border border-gray-300 px-2 py-1 text-right text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
                                  ) : (item.fee !== null && item.fee !== 0 ? formatNumber(item.fee, 2) : '-')}
                                </td>
                                <td className={`whitespace-nowrap px-4 py-3 text-right text-sm font-semibold ${profitColor(profitRate)}`}>
                                  {profit !== null ? (
                                    <span>{(profit >= 0 ? '+' : '') + formatNumber(profit, 2)}
                                      {profitRate !== null && <span className="ml-1 text-xs">({(profitRate >= 0 ? '+' : '') + formatNumber(profitRate, 2)}%)</span>}
                                    </span>
                                  ) : '-'}
                                </td>
                                <td className="whitespace-nowrap px-4 py-3 text-left text-sm text-gray-700">
                                  {isEditing ? (
                                    <input type="text" value={editNotes} onChange={(e) => setEditNotes(e.target.value)}
                                      placeholder="备注"
                                      className="w-28 rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
                                  ) : (item.notes || '-')}
                                </td>
                                <td className="whitespace-nowrap px-4 py-3 text-center text-sm">
                                  {isEditing ? (
                                    <div className="flex items-center justify-center gap-2">
                                      <button onClick={() => handleEditSave(item.id)} disabled={savingEdit}
                                        className="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">{savingEdit ? '保存中' : '保存'}</button>
                                      <button onClick={handleEditCancel}
                                        className="rounded bg-gray-200 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-300">取消</button>
                                    </div>
                                  ) : (
                                    <div className="flex items-center justify-center gap-3">
                                      <button onClick={() => handleEditStart(item)} className="text-blue-600 hover:text-blue-800 hover:underline">编辑</button>
                                      <button onClick={() => handleDelete(item.id)} className="text-red-600 hover:text-red-800 hover:underline">删除</button>
                                    </div>
                                  )}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )
              })
            )}

            {/* ===== 已清仓区域 — 移至底部，取消折叠，带滚动条 ===== */}
            {(closedStocks.length > 0 || closedOptions.length > 0) && (
              <div className="mt-8 space-y-4">
                <h2 className="text-lg font-bold text-gray-800 border-t pt-6">已清仓记录</h2>

                {/* 已清仓股票 — 按市场分组，每个市场一个区块 */}
                {marketOrder.map(market => {
                  const csItems = closedStocksByMarket[market] || []
                  if (csItems.length === 0) return null
                  const s = calcStockSummary(csItems)
                  return (
                    <div key={`cs-${market}`} className="rounded-lg bg-white shadow">
                      <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
                        <h3 className="text-base font-bold text-gray-900">{market} 已清仓股票</h3>
                        <div className="flex gap-4 text-sm">
                          <span className="text-gray-500">成本: <span className="font-semibold text-gray-900">{formatCurrency(s.cost)}</span></span>
                          <span className="text-gray-500">盈亏: <span className={`font-semibold ${profitColor(s.profitRate)}`}>{(s.profit >= 0 ? '+' : '') + formatNumber(s.profit, 2)}</span></span>
                          <span className={`font-semibold ${profitColor(s.profitRate)}`}>{s.profitRate !== null ? (s.profitRate >= 0 ? '+' : '') + formatNumber(s.profitRate, 2) + '%' : '-'}</span>
                        </div>
                      </div>
                      <div className="p-3">
                        <ClosedStockForm market={market} onAdded={loadData} />
                        <div className="max-h-[400px] overflow-y-auto rounded border border-gray-100">
                          <ClosedStockTable items={csItems} onDelete={handleDeleteClosedStock} onUpdate={handleUpdateClosedStock} />
                        </div>
                      </div>
                    </div>
                  )
                })}

                {/* 已清仓期权 — 按市场分组，仅美股和港股 */}
                {marketOrder.filter(m => m !== 'A股').map(market => {
                  const coItems = closedOptionsByMarket[market] || []
                  if (coItems.length === 0) return null
                  const s = calcOptionSummary(coItems)
                  return (
                    <div key={`co-${market}`} className="rounded-lg bg-white shadow">
                      <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
                        <h3 className="text-base font-bold text-gray-900">{market} 已清仓期权</h3>
                        <div className="flex gap-4 text-sm">
                          <span className="text-gray-500">保证金: <span className="font-semibold text-gray-900">{formatCurrency(s.cost)}</span></span>
                          <span className="text-gray-500">盈亏: <span className={`font-semibold ${profitColor(s.profitRate)}`}>{(s.profit >= 0 ? '+' : '') + formatNumber(s.profit, 2)}</span></span>
                          <span className={`font-semibold ${profitColor(s.profitRate)}`}>{s.profitRate !== null ? (s.profitRate >= 0 ? '+' : '') + formatNumber(s.profitRate, 2) + '%' : '-'}</span>
                        </div>
                      </div>
                      <div className="p-3">
                        <ClosedOptionForm market={market} onAdded={loadData} />
                        <div className="max-h-[400px] overflow-y-auto rounded border border-gray-100">
                          <ClosedOptionTable items={coItems} onDelete={handleDeleteClosedOption} onUpdate={handleUpdateClosedOption} />
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  )
}
