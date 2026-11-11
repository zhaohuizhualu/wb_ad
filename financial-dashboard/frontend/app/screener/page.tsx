'use client'

import { useState } from 'react'
import { ScreenerResult, screenStocks } from '@/lib/api'
import CompanyLogo from '@/components/CompanyLogo'

const MARKETS = ['A股', '港股', '美股']

// 毛利率：10%~100%，等分十档
const GROSS_MARGIN_OPTIONS = Array.from({ length: 10 }, (_, i) => 10 + i * 10)

// 净利率：5%~50%，等分十档
const NET_MARGIN_OPTIONS = Array.from({ length: 10 }, (_, i) => {
  const v = 5 + i * 4.5
  return Math.round(v * 10) / 10
})

// 营收同比：5%~50%，等分十档
const REVENUE_YOY_OPTIONS = Array.from({ length: 10 }, (_, i) => {
  const v = 5 + i * 4.5
  return Math.round(v * 10) / 10
})

const CURRENT_YEAR = new Date().getFullYear()

export default function ScreenerPage() {
  const [market, setMarket] = useState('A股')
  const [startYear, setStartYear] = useState(2015)
  const [endYear, setEndYear] = useState<string>('')
  const [grossMargin, setGrossMargin] = useState('10')
  const [netMargin, setNetMargin] = useState('5')
  const [revenueYoy, setRevenueYoy] = useState('5')

  const [results, setResults] = useState<ScreenerResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [searched, setSearched] = useState(false)
  const [resultMsg, setResultMsg] = useState('')

  const handleSearch = async () => {
    setLoading(true)
    setError('')
    setSearched(true)

    try {
      const params: Record<string, string | number> = {
        market,
        start_year: startYear,
        gross_margin_min: grossMargin,
        net_margin_min: netMargin,
        revenue_yoy_min: revenueYoy,
      }
      if (endYear) {
        params.end_year = parseInt(endYear)
      }

      const data = await screenStocks(params)
      setResults(data.results)
      setResultMsg(data.message)
    } catch (err: any) {
      console.error('筛选失败:', err)
      setError('筛选失败: ' + (err?.message || String(err)))
      setResults([])
    } finally {
      setLoading(false)
    }
  }

  const handleReset = () => {
    setMarket('A股')
    setStartYear(2015)
    setEndYear('')
    setGrossMargin('10')
    setNetMargin('5')
    setRevenueYoy('5')
    setResults([])
    setSearched(false)
    setError('')
    setResultMsg('')
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <header className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">筛选股票</h1>
          <p className="mt-2 text-sm text-gray-500">
            根据财报数据筛选满足条件的股票，支持A股、港股、美股。统计期间各指标历年均值超过设定阈值。
          </p>
        </header>

        {/* 筛选表单 */}
        <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {/* 市场 */}
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                市场 <span className="text-red-500">*</span>
              </label>
              <select
                value={market}
                onChange={(e) => setMarket(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {MARKETS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>

            {/* 起始年份 */}
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                起始年份 <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                value={startYear}
                onChange={(e) => setStartYear(parseInt(e.target.value) || 2015)}
                min={2000}
                max={CURRENT_YEAR}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {/* 终止年份 */}
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                终止年份 <span className="text-gray-400 text-xs">(空=截止当前)</span>
              </label>
              <input
                type="number"
                value={endYear}
                onChange={(e) => setEndYear(e.target.value)}
                placeholder={String(CURRENT_YEAR)}
                min={2000}
                max={CURRENT_YEAR}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {/* 毛利率 */}
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                毛利率均值 &gt; <span className="text-blue-600 font-semibold">{grossMargin}%</span>
              </label>
              <input
                type="range"
                min={10}
                max={100}
                step={10}
                value={grossMargin}
                onChange={(e) => setGrossMargin(e.target.value)}
                className="w-full accent-blue-600"
                list="grossMarginMarks"
              />
              <datalist id="grossMarginMarks">
                {GROSS_MARGIN_OPTIONS.map(v => (
                  <option key={v} value={v}>{v}%</option>
                ))}
              </datalist>
              <div className="mt-1 flex justify-between text-xs text-gray-400">
                <span>10%</span>
                <span>100%</span>
              </div>
            </div>

            {/* 净利率 */}
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                净利率均值 &gt; <span className="text-blue-600 font-semibold">{netMargin}%</span>
              </label>
              <input
                type="range"
                min={5}
                max={50}
                step={4.5}
                value={netMargin}
                onChange={(e) => setNetMargin(e.target.value)}
                className="w-full accent-blue-600"
                list="netMarginMarks"
              />
              <datalist id="netMarginMarks">
                {NET_MARGIN_OPTIONS.map(v => (
                  <option key={v} value={v}>{v}%</option>
                ))}
              </datalist>
              <div className="mt-1 flex justify-between text-xs text-gray-400">
                <span>5%</span>
                <span>50%</span>
              </div>
            </div>

            {/* 营收同比 */}
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                营收同比均值 &gt; <span className="text-blue-600 font-semibold">{revenueYoy}%</span>
              </label>
              <input
                type="range"
                min={5}
                max={50}
                step={4.5}
                value={revenueYoy}
                onChange={(e) => setRevenueYoy(e.target.value)}
                className="w-full accent-blue-600"
                list="revenueYoyMarks"
              />
              <datalist id="revenueYoyMarks">
                {REVENUE_YOY_OPTIONS.map(v => (
                  <option key={v} value={v}>{v}%</option>
                ))}
              </datalist>
              <div className="mt-1 flex justify-between text-xs text-gray-400">
                <span>5%</span>
                <span>50%</span>
              </div>
            </div>
          </div>

          {/* 操作按钮 */}
          <div className="mt-6 flex justify-end gap-3">
            <button
              onClick={handleReset}
              className="rounded-lg border border-gray-300 px-5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              重置
            </button>
            <button
              onClick={handleSearch}
              disabled={loading}
              className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white shadow hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? '筛选中...' : '开始筛选'}
            </button>
          </div>
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* 结果区域 */}
        {searched && !loading && !error && (
          <div className="mt-8">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900">
                筛选结果
              </h2>
              <span className="text-sm text-gray-500">
                {resultMsg}
              </span>
            </div>

            {results.length === 0 ? (
              <div className="rounded-xl border border-gray-100 bg-white py-16 text-center text-gray-500 shadow-sm">
                没有找到符合条件的股票
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-gray-100 bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 font-medium text-gray-600">#</th>
                      <th className="px-4 py-3 font-medium text-gray-600">公司名称</th>
                      <th className="px-4 py-3 font-medium text-gray-600">股票代码</th>
                      <th className="px-4 py-3 font-medium text-gray-600">数据年份</th>
                      <th className="px-4 py-3 font-medium text-gray-600">年数</th>
                      <th className="px-4 py-3 font-medium text-gray-600">
                        <span className="text-red-600">毛利率</span>均值
                      </th>
                      <th className="px-4 py-3 font-medium text-gray-600">
                        <span className="text-red-600">净利率</span>均值
                      </th>
                      <th className="px-4 py-3 font-medium text-gray-600">
                        <span className="text-red-600">营收同比</span>均值
                      </th>
                      <th className="px-4 py-3 font-medium text-gray-600">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((item, idx) => (
                      <tr
                        key={item.code}
                        className="border-b border-gray-50 transition hover:bg-blue-50/50"
                      >
                        <td className="px-4 py-3 text-gray-400">{idx + 1}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <CompanyLogo name={item.name} logoUrl="" />
                            <span className="font-medium text-gray-900">{item.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-600 font-mono">{item.code}</td>
                        <td className="px-4 py-3 text-gray-600">{item.year_range}</td>
                        <td className="px-4 py-3 text-gray-600">{item.year_count}</td>
                        <td className="px-4 py-3">
                          <span className="font-semibold text-red-600">
                            {item.avg_gross_margin !== null ? item.avg_gross_margin + '%' : '-'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-semibold text-red-600">
                            {item.avg_net_margin !== null ? item.avg_net_margin + '%' : '-'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-semibold text-red-600">
                            {item.avg_revenue_yoy !== null ? item.avg_revenue_yoy + '%' : '-'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <a
                            href={'/company/' + item.code}
                            className="text-blue-600 hover:underline"
                          >
                            查看详情 →
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* 加载中 */}
        {loading && (
          <div className="mt-8 py-20 text-center text-gray-500">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-4">正在筛选...</p>
          </div>
        )}
      </div>
    </main>
  )
}
