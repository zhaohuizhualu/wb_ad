'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  BarChart,
  Bar,
} from 'recharts'
import CompanyLogo from '@/components/CompanyLogo'
import CollapsibleSection from '@/components/CollapsibleSection'
import ZoomableChart from '@/components/ZoomableChart'
import {
  getCompanies,
  getMetrics,
  getQuarterlyMetrics,
  getBusinessUpdates,
  refreshCompanyData,
  Company,
  CoreMetric,
  QuarterlyMetric,
  BusinessUpdate,
} from '@/lib/api'
import {
  formatCurrency,
  formatCurrencyName,
  formatPercent,
  formatGrowth,
  growthColor,
} from '@/lib/format'


function yoyRange(min: number, max: number): string {
  if (min === max) return min + '%'
  return min + '% ~ ' + max + '%'
}

function yoyColor(min: number): string {
  return min < 0 ? 'text-green-600' : 'text-red-600'
}

const currencyAxisFormatter = (value: number): string =>
  value >= 100000000
    ? (value / 100000000).toFixed(0) + '亿'
    : value >= 10000
    ? (value / 10000).toFixed(0) + '万'
    : String(value)

export default function CompanyDetail({
  params,
}: {
  params: { code: string }
}) {
  const code = decodeURIComponent(params.code)
  const [company, setCompany] = useState<Company | null>(null)
  const [metrics, setMetrics] = useState<CoreMetric[]>([])
  const [quarterly, setQuarterly] = useState<QuarterlyMetric[]>([])
  const [businessUpdates, setBusinessUpdates] = useState<BusinessUpdate[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [autoFetching, setAutoFetching] = useState(false)
  const [error, setError] = useState('')
  const [refreshMsg, setRefreshMsg] = useState('')

  useEffect(() => {
    let active = true

    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const [companies, annualMetrics] = await Promise.all([
          getCompanies(),
          getMetrics(code),
        ])
        if (!active) return

        const foundCompany = companies.find((item) => item.code === code) ?? null
        setCompany(foundCompany)
        setMetrics([...annualMetrics].reverse())

        // 如果没有年度财务数据，自动触发数据加载
        if (annualMetrics.length === 0 && foundCompany) {
          if (active) {
            setAutoFetching(true)
          }
          try {
            const result = await refreshCompanyData(code)
            if (!active) return
            // 重新拉取数据
            const [refreshedMetrics, quarterlyMetrics, updates] = await Promise.all([
              getMetrics(code),
              getQuarterlyMetrics(code).catch(() => [] as QuarterlyMetric[]),
              getBusinessUpdates(code).catch(() => [] as BusinessUpdate[]),
            ])
            if (active) {
              setMetrics([...refreshedMetrics].reverse())
              setQuarterly(quarterlyMetrics)
              setBusinessUpdates(updates)
              if (refreshedMetrics.length === 0) {
                setError('未能获取到财务数据，请稍后手动刷新重试')
              }
            }
          } catch (fetchErr) {
            console.error('自动拉取财务数据失败:', fetchErr)
            if (active) {
              setError('财务数据自动加载失败，请稍后点击「刷新数据」重试')
            }
          } finally {
            if (active) setAutoFetching(false)
          }
        } else {
          const [quarterlyMetrics, updates] = await Promise.all([
            getQuarterlyMetrics(code).catch(() => [] as QuarterlyMetric[]),
            getBusinessUpdates(code).catch(() => [] as BusinessUpdate[]),
          ])
          if (active) {
            setQuarterly(quarterlyMetrics)
            setBusinessUpdates(updates)
          }
        }
      } catch (err) {
        console.error('获取数据失败:', err)
        if (active) setError('财务数据加载失败，请稍后重试')
      } finally {
        if (active) setLoading(false)
      }
    }

    load()
    return () => {
      active = false
    }
  }, [code])



  const handleRefresh = async () => {
    setRefreshing(true)
    setRefreshMsg('')
    setError('')
    try {
      const result = await refreshCompanyData(code)
      setRefreshMsg(result.message + " (年度" + result.annual_records + "条 / 季度" + result.quarter_records + "条)")
      // 刷新页面数据
      const [companies, annualMetrics] = await Promise.all([
        getCompanies(),
        getMetrics(code),
      ])
      setCompany(companies.find((item) => item.code === code) ?? null)
      setMetrics([...annualMetrics].reverse())
      const [quarterlyMetrics, updates] = await Promise.all([
        getQuarterlyMetrics(code).catch(() => []),
        getBusinessUpdates(code).catch(() => []),
      ])
      setQuarterly(quarterlyMetrics)
      setBusinessUpdates(updates)
    } catch (err) {
      console.error('刷新数据失败:', err)
      setError('数据更新失败: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setRefreshing(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600"></div>
          <p className="text-gray-600">页面加载中...</p>
        </div>
      </div>
    )
  }

  if (autoFetching) {
    return (
      <main className="min-h-screen bg-gray-50 p-8">
        <div className="mx-auto max-w-7xl">
          <div className="mb-6">
            <Link href="/" className="text-blue-600 hover:underline">
              ← 返回首页
            </Link>
          </div>
          <div className="flex flex-col items-center justify-center rounded-lg bg-white p-16 shadow">
            <div className="mx-auto mb-6 h-16 w-16 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600"></div>
            <h2 className="text-xl font-semibold text-gray-900">数据加载中</h2>
            <p className="mt-2 text-gray-500">
              正在从东方财富拉取 {company?.name || code} 的财务数据，请稍候...
            </p>
          </div>
        </div>
      </main>
    )
  }

  if (error) {
    return (
      <main className="min-h-screen bg-gray-50 p-8">
        <div className="mx-auto max-w-7xl">
          <div className="mb-6">
            <Link href="/" className="text-blue-600 hover:underline">
              ← 返回首页
            </Link>
          </div>
          <div className="rounded-lg bg-white p-10 text-center text-red-500 shadow">
            {error}
          </div>
        </div>
      </main>
    )
  }

  if (!company) {
    return (
      <main className="min-h-screen bg-gray-50 p-8">
        <div className="mx-auto max-w-7xl">
          <div className="mb-6">
            <Link href="/" className="text-blue-600 hover:underline">
              ← 返回首页
            </Link>
          </div>
          <div className="rounded-lg bg-white p-10 text-center text-gray-500 shadow">
            未找到公司 {code}
          </div>
        </div>
      </main>
    )
  }

  if (metrics.length === 0) {
    return (
      <main className="min-h-screen bg-gray-50 p-8">
        <div className="mx-auto max-w-7xl">
          <div className="mb-6">
            <Link href="/" className="text-blue-600 hover:underline">
              ← 返回首页
            </Link>
          </div>
          <div className="flex flex-col items-center justify-center rounded-lg bg-white p-16 shadow">
            <p className="text-gray-600">{company.name} 暂无财务数据</p>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="mt-4 rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {refreshing ? '正在刷新...' : '刷新数据'}
            </button>
          </div>
        </div>
      </main>
    )
  }

  const companyName = company?.name || code
  const latest = metrics[metrics.length - 1]
  const currency = company?.currency || 'CNY'
  const currencyName = formatCurrencyName(currency)
  const isHalfYear = quarterly.some(
    (item) => item.period_type === 'half_year'
  )
  const periodLabel = isHalfYear ? '半年度' : '单季度'

  const summaryCards = latest
    ? [
        {
          label: '营业收入（最新年度）',
          value: formatCurrency(latest.revenue, currency),
          growth: latest.revenue_yoy,
        },
        {
          label: '毛利润（最新年度）',
          value: formatCurrency(latest.gross_profit, currency),
          growth: latest.gross_profit_yoy,
        },
        {
          label: '净利润（最新年度）',
          value: formatCurrency(latest.net_profit, currency),
          growth: latest.net_profit_yoy,
        },
        { label: '毛利率（最新年度）', value: formatPercent(latest.gross_margin) },
        { label: '净利率（最新年度）', value: formatPercent(latest.net_margin) },
        {
          label: '自由现金流（最新年度）',
          value: formatCurrency(latest.free_cash_flow, currency),
        },
      ]
    : []

  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6">
          <Link href="/" className="text-blue-600 hover:underline">
            ← 返回首页
          </Link>
        </div>

        <header className="mb-8 flex items-start justify-between">
          <div className="flex items-center gap-4">
            <CompanyLogo
              name={companyName}
              logoUrl={company?.logo_url}
              size="sm"
            />
            <div>
              <h1 className="text-3xl font-bold">
                {companyName}
                <span className="ml-2 text-lg font-normal text-gray-500">
                  （{code}）
                </span>
              </h1>
              <p className="mt-1 text-gray-600">
                年度及{periodLabel}核心财务指标（{currencyName}，每日06:00自动更新）
              </p>
            </div>
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {refreshing ? '更新中...' : '数据更新'}
          </button>
        </header>

        {refreshMsg && (
          <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
            {refreshMsg}
          </div>
        )}

        {/* 业绩速报 */}
        {businessUpdates.length > 0 && (
          <div className="mb-8 space-y-4">
            {businessUpdates.map((update) => (
              <div
                key={update.id}
                className="rounded-lg border-l-4 border-red-500 bg-white p-6 shadow"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-xl font-bold text-red-600">
                      {update.title}
                    </h2>
                    <p className="mt-1 text-sm text-gray-500">
                      公告日期：{update.announce_date} · {update.report_year}年{update.report_period} · 数据来源：{update.source}
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-gray-600">整体收益同比</div>
                    <div className={"text-2xl font-bold " + yoyColor(update.revenue_yoy_min)}>
                      {yoyRange(update.revenue_yoy_min, update.revenue_yoy_max)}
                    </div>
                  </div>
                </div>

                <p className="mt-3 text-gray-700 leading-relaxed">{update.summary}</p>

                {update.regions && update.regions.length > 0 && (
                  <div className="mt-4">
                    <h3 className="mb-2 text-sm font-semibold text-gray-700">分区域收益同比变化</h3>
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
                      {update.regions.map((region) => (
                        <div key={region.name} className="rounded-lg bg-gray-50 p-3 text-center">
                          <div className="text-sm text-gray-600">{region.name}</div>
                          <div className={"mt-1 text-lg font-bold " + yoyColor(region.yoy_min)}>
                            {yoyRange(region.yoy_min, region.yoy_max)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {update.channels && update.channels.length > 0 && (
                  <div className="mt-4">
                    <h3 className="mb-2 text-sm font-semibold text-gray-700">分渠道收益同比变化（中国市场）</h3>
                    <div className="grid grid-cols-2 gap-3">
                      {update.channels.map((channel) => (
                        <div key={channel.name} className="rounded-lg bg-gray-50 p-3 text-center">
                          <div className="text-sm text-gray-600">{channel.name}</div>
                          <div className={"mt-1 text-lg font-bold " + yoyColor(channel.yoy_min)}>
                            {yoyRange(channel.yoy_min, channel.yoy_max)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {summaryCards.length > 0 ? (
          <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-6">
            {summaryCards.map((card) => (
              <div
                key={card.label}
                className="rounded-lg bg-white p-4 shadow"
              >
                <div className="text-sm text-gray-600">{card.label}</div>
                <div className="mt-1 text-xl font-bold">{card.value}</div>
                {card.growth !== undefined && card.growth !== null && (
                  <div className={`mt-0.5 text-sm font-medium ${growthColor(card.growth)}`}>
                    同比 {formatGrowth(card.growth)}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="mb-8 rounded-lg bg-white p-6 text-gray-500 shadow">
            暂无年度财务数据
          </div>
        )}

        {/* 年度趋势图：营收 */}
        <div className="mb-8 rounded-lg bg-white p-6 shadow">
          <h2 className="mb-4 text-xl font-bold">
            营收、毛利润、净利润趋势（年度）
          </h2>
          <ZoomableChart
            data={metrics}
            xKey="year"
            height={400}
            render={({ data, handlers, selection }) => (
              <LineChart data={data} {...handlers}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="year" />
                <YAxis tickFormatter={currencyAxisFormatter} />
                <Tooltip
                  formatter={(value) => formatCurrency(Number(value), currency)}
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="revenue"
                  name="营业收入"
                  stroke="#ef4444"
                  strokeWidth={2}
                />
                <Line
                  type="monotone"
                  dataKey="gross_profit"
                  name="毛利润"
                  stroke="#f59e0b"
                  strokeWidth={2}
                />
                <Line
                  type="monotone"
                  dataKey="net_profit"
                  name="净利润"
                  stroke="#3b82f6"
                  strokeWidth={2}
                />
                {selection}
              </LineChart>
            )}
          />
        </div>

        {/* 年度趋势图：利润率 */}
        <div className="mb-8 rounded-lg bg-white p-6 shadow">
          <h2 className="mb-4 text-xl font-bold">
            毛利率、净利率趋势（年度）
          </h2>
          <ZoomableChart
            data={metrics}
            xKey="year"
            height={300}
            render={({ data, handlers, selection }) => (
              <LineChart data={data} {...handlers}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="year" />
                <YAxis tickFormatter={(value) => value + '%'} />
                <Tooltip formatter={(value) => formatPercent(Number(value))} />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="gross_margin"
                  name="毛利率"
                  stroke="#ef4444"
                  strokeWidth={2}
                />
                <Line
                  type="monotone"
                  dataKey="net_margin"
                  name="净利率"
                  stroke="#3b82f6"
                  strokeWidth={2}
                />
                {selection}
              </LineChart>
            )}
          />
        </div>

        {/* 年度增速图 */}
        {metrics.some((m) => m.revenue_yoy !== null && m.revenue_yoy !== undefined) && (
          <div className="mb-8 rounded-lg bg-white p-6 shadow">
            <h2 className="mb-4 text-xl font-bold">
              同比增速趋势（年度）
            </h2>
            <ZoomableChart
              data={metrics}
              xKey="year"
              height={300}
              render={({ data, handlers, selection }) => (
                <LineChart data={data} {...handlers}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="year" />
                  <YAxis tickFormatter={(value) => value + '%'} />
                  <Tooltip formatter={(value) => formatGrowth(Number(value))} />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="revenue_yoy"
                    name="营收同比"
                    stroke="#ef4444"
                    strokeWidth={2}
                  />
                  <Line
                    type="monotone"
                    dataKey="net_profit_yoy"
                    name="净利润同比"
                    stroke="#3b82f6"
                    strokeWidth={2}
                  />
                  {selection}
                </LineChart>
              )}
            />
          </div>
        )}

        <CollapsibleSection
          title="详细财务数据（年度）"
          subtitle={`共 ${metrics.length} 个年度 · 含同比增速`}
        >
          <div className="max-h-[26rem] overflow-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="sticky top-0 z-10 bg-gray-50 px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">年份</th>
                  <th className="sticky top-0 z-10 bg-gray-50 px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">营业收入</th>
                  <th className="sticky top-0 z-10 bg-gray-50 px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">营收同比</th>
                  <th className="sticky top-0 z-10 bg-gray-50 px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">净利润</th>
                  <th className="sticky top-0 z-10 bg-gray-50 px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">净利同比</th>
                  <th className="sticky top-0 z-10 bg-gray-50 px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">毛利率</th>
                  <th className="sticky top-0 z-10 bg-gray-50 px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">净利率</th>
                  <th className="sticky top-0 z-10 bg-gray-50 px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">自由现金流</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {[...metrics].reverse().map((metric) => (
                  <tr key={metric.year} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">{metric.year}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-gray-900">{formatCurrency(metric.revenue, currency)}</td>
                    <td className={`whitespace-nowrap px-4 py-3 text-right text-sm font-medium ${growthColor(metric.revenue_yoy)}`}>{formatGrowth(metric.revenue_yoy)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-gray-900">{formatCurrency(metric.net_profit, currency)}</td>
                    <td className={`whitespace-nowrap px-4 py-3 text-right text-sm font-medium ${growthColor(metric.net_profit_yoy)}`}>{formatGrowth(metric.net_profit_yoy)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-gray-900">{formatPercent(metric.gross_margin)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-gray-900">{formatPercent(metric.net_margin)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-gray-900">{formatCurrency(metric.free_cash_flow, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CollapsibleSection>

        {quarterly.length > 0 ? (
          <>
            <div className="mb-8 rounded-lg bg-white p-6 shadow">
              <h2 className="mb-4 text-xl font-bold">
                {periodLabel}营收、毛利润、净利润趋势
              </h2>
              <ZoomableChart
                data={quarterly}
                xKey="label"
                height={400}
                render={({ data, handlers, selection }) => (
                  <BarChart data={data} {...handlers}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="label" />
                    <YAxis tickFormatter={currencyAxisFormatter} />
                    <Tooltip
                      formatter={(value) =>
                        formatCurrency(Number(value), currency)
                      }
                    />
                    <Legend />
                    <Bar dataKey="revenue" name="营业收入" fill="#ef4444" />
                    <Bar dataKey="gross_profit" name="毛利润" fill="#f59e0b" />
                    <Bar dataKey="net_profit" name="净利润" fill="#3b82f6" />
                    {selection}
                  </BarChart>
                )}
              />
            </div>

            <CollapsibleSection
              title={`${periodLabel}详细数据`}
              subtitle={`共 ${quarterly.length} 期 · 含同比/环比增速`}
            >
              <div className="max-h-[26rem] overflow-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="sticky top-0 z-10 bg-gray-50 px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">{periodLabel}</th>
                      <th className="sticky top-0 z-10 bg-gray-50 px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">营业收入</th>
                      <th className="sticky top-0 z-10 bg-gray-50 px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">营收同比</th>
                      <th className="sticky top-0 z-10 bg-gray-50 px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">营收环比</th>
                      <th className="sticky top-0 z-10 bg-gray-50 px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">净利润</th>
                      <th className="sticky top-0 z-10 bg-gray-50 px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">净利同比</th>
                      <th className="sticky top-0 z-10 bg-gray-50 px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">净利环比</th>
                      <th className="sticky top-0 z-10 bg-gray-50 px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">毛利率</th>
                      <th className="sticky top-0 z-10 bg-gray-50 px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">净利率</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 bg-white">
                    {[...quarterly].reverse().map((item) => (
                      <tr key={item.label} className="hover:bg-gray-50">
                        <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">{item.label}（{item.quarter}）</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-gray-900">{formatCurrency(item.revenue, currency)}</td>
                        <td className={`whitespace-nowrap px-4 py-3 text-right text-sm font-medium ${growthColor(item.revenue_yoy)}`}>{formatGrowth(item.revenue_yoy)}</td>
                        <td className={`whitespace-nowrap px-4 py-3 text-right text-sm font-medium ${growthColor(item.revenue_qoq)}`}>{formatGrowth(item.revenue_qoq)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-gray-900">{formatCurrency(item.net_profit, currency)}</td>
                        <td className={`whitespace-nowrap px-4 py-3 text-right text-sm font-medium ${growthColor(item.net_profit_yoy)}`}>{formatGrowth(item.net_profit_yoy)}</td>
                        <td className={`whitespace-nowrap px-4 py-3 text-right text-sm font-medium ${growthColor(item.net_profit_qoq)}`}>{formatGrowth(item.net_profit_qoq)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-gray-900">{formatPercent(item.gross_margin)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-gray-900">{formatPercent(item.net_margin)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CollapsibleSection>
          </>
        ) : (
          <div className="rounded-lg bg-white p-6 text-gray-500 shadow">
            暂无{periodLabel}财务数据
          </div>
        )}
      </div>
    </main>
  )
}
