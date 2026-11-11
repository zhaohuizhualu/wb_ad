const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || '/api'

const request = async <T>(path: string): Promise<T> => {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    cache: 'no-store',
  })
  if (!response.ok) {
    throw new Error(`请求失败: ${response.status} ${path}`)
  }
  return (await response.json()) as T
}

const postRequest = async <T>(path: string, body?: unknown): Promise<T> => {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!response.ok) {
    throw new Error(`请求失败: ${response.status} ${path}`)
  }
  return (await response.json()) as T
}

const putRequest = async <T>(path: string, body?: unknown): Promise<T> => {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!response.ok) {
    throw new Error(`请求失败: ${response.status} ${path}`)
  }
  return (await response.json()) as T
}

const deleteRequest = async <T>(path: string): Promise<T> => {
  const response = await fetch(`${API_BASE_URL}${path}`, { method: 'DELETE' })
  if (!response.ok) {
    throw new Error(`请求失败: ${response.status} ${path}`)
  }
  return (await response.json()) as T
}

export interface Company {
  id: number
  code: string
  name: string
  exchange?: string | null
  logo_url?: string | null
  currency?: string | null
}

export interface CoreMetric {
  year: number
  report_type: string
  revenue: number
  gross_profit: number
  net_profit: number
  gross_margin: number
  net_margin: number
  free_cash_flow: number | null
  revenue_yoy?: number | null
  gross_profit_yoy?: number | null
  net_profit_yoy?: number | null
}

export interface QuarterlyMetric {
  label: string
  year: number
  quarter: string
  revenue: number
  gross_profit: number
  net_profit: number
  gross_margin: number
  net_margin: number
  period_type?: 'quarter' | 'half_year'
  revenue_yoy?: number | null
  gross_profit_yoy?: number | null
  net_profit_yoy?: number | null
  revenue_qoq?: number | null
  gross_profit_qoq?: number | null
  net_profit_qoq?: number | null
}

export interface BusinessUpdateRegion {
  name: string
  yoy_min: number
  yoy_max: number
}

export interface BusinessUpdateChannel {
  name: string
  yoy_min: number
  yoy_max: number
}

export interface BusinessUpdate {
  id: number
  company_id: number
  report_year: number
  report_period: string
  announce_date: string
  title: string
  summary: string
  revenue_yoy_min: number | null
  revenue_yoy_max: number | null
  regions: BusinessUpdateRegion[]
  channels: BusinessUpdateChannel[]
  source: string
}

export interface DataRefreshResult {
  success: boolean
  message: string
  annual_records: number
  quarter_records: number
}

export interface PortfolioItem {
  id: number
  code: string
  name: string
  market: string
  shares: number
  avg_cost: number | null
  fee: number | null
  last_price: number | null
  last_price_date: string | null
  notes: string | null
}

export interface PortfolioSummary {
  markets: Record<string, {
    items: PortfolioItem[]
    total_market_value: number
    total_cost: number
    total_profit: number
    profit_rate: number | null
  }>
  grand_total: number
  grand_cost: number
  grand_profit: number
  grand_profit_rate: number | null
  exchange_rates?: {
    USD_CNY: number
    HKD_CNY: number
    updated_at: string
  }
}

export interface StockSearchResult {
  code: string
  name: string
  market_type: string
}

export interface ScreenerResult {
  code: string
  name: string
  currency: string
  year_range: string
  year_count: number
  avg_gross_margin: number | null
  avg_net_margin: number | null
  avg_revenue_yoy: number | null
}

export interface ScreenerResponse {
  success: boolean
  message: string
  results: ScreenerResult[]
  total: number
}

export interface AddCompanyResult {
  success: boolean
  id: number
  code: string
  name: string
  message: string
}

// ---------- Closed Positions Types ----------

export interface ClosedStock {
  id: number
  code: string
  name: string
  market: string
  buy_date: string | null
  sell_date: string | null
  shares: number
  buy_price: number | null
  sell_price: number | null
  fee: number | null
  notes: string | null
  // auto-calculated
  buy_total: number | null
  sell_total: number | null
  profit: number | null
  profit_rate: number | null
  holding_days: number | null
  annualized: number | null
}

export interface ClosedOption {
  id: number
  underlying_code: string
  contract_code: string
  market: string
  option_type: string | null
  direction: string | null
  strike_price: number | null
  open_date: string | null
  close_date: string | null
  contracts: number
  multiplier: number
  open_premium: number | null
  close_premium: number | null
  fee: number | null
  notes: string | null
  // auto-calculated
  open_total: number | null
  close_total: number | null
  net_premium: number | null
  margin: number | null
  profit_rate: number | null
  holding_days: number | null
  annualized: number | null
}

export const getMetrics = async (code: string): Promise<CoreMetric[]> =>
  request(`/metrics?code=${encodeURIComponent(code)}`)

export const getQuarterlyMetrics = async (code: string): Promise<QuarterlyMetric[]> =>
  request(`/metrics/quarterly?code=${encodeURIComponent(code)}`)

export const getCompanies = async (): Promise<Company[]> =>
  request('/companies')

export const addCompany = async (item: { code: string; name?: string }): Promise<AddCompanyResult> =>
  postRequest('/companies', item)

export const getBusinessUpdates = async (code: string): Promise<BusinessUpdate[]> =>
  request(`/business-updates?code=${encodeURIComponent(code)}`)

export const refreshCompanyData = async (code: string): Promise<DataRefreshResult> =>
  postRequest(`/data-refresh/${encodeURIComponent(code)}`)

export const stockSearch = async (query: string): Promise<StockSearchResult[]> =>
  request(`/stock-search?q=${encodeURIComponent(query)}&limit=5`)

export const getPortfolio = async (): Promise<PortfolioItem[]> =>
  request('/portfolio')

export const addPortfolioItem = async (item: {
  code: string
  name: string
  market: string
  shares: number
  avg_cost?: number
  fee?: number
  notes?: string
}): Promise<PortfolioItem> =>
  postRequest('/portfolio', item)

export const updatePortfolioItem = async (id: number, item: {
  shares?: number
  avg_cost?: number
  fee?: number
  notes?: string
}): Promise<{ success: boolean; id: number }> =>
  putRequest(`/portfolio/${id}`, item)

export const deletePortfolioItem = async (id: number): Promise<{ success: boolean; id: number }> =>
  deleteRequest(`/portfolio/${id}`)

export const refreshPortfolioPrices = async (): Promise<{ success: boolean; updated_count: number }> =>
  postRequest('/portfolio/refresh-prices')

export const getPortfolioSummary = async (): Promise<PortfolioSummary> =>
  request('/portfolio/summary')

// ---------- Closed Positions API ----------

export const getClosedStocks = async (market?: string): Promise<ClosedStock[]> =>
  request(`/closed-stocks${market ? `?market=${encodeURIComponent(market)}` : ''}`)

export const addClosedStock = async (item: {
  code: string
  name: string
  market: string
  buy_date?: string
  sell_date?: string
  shares: number
  buy_price?: number
  sell_price?: number
  fee?: number
  notes?: string
}): Promise<{ success: boolean; id: number }> =>
  postRequest('/closed-stocks', item)

export const updateClosedStock = async (id: number, item: {
  code?: string
  name?: string
  market?: string
  buy_date?: string
  sell_date?: string
  shares?: number
  buy_price?: number
  sell_price?: number
  fee?: number
  notes?: string
}): Promise<{ success: boolean; id: number }> =>
  putRequest(`/closed-stocks/${id}`, item)

export const deleteClosedStock = async (id: number): Promise<{ success: boolean; id: number }> =>
  deleteRequest(`/closed-stocks/${id}`)

export const getClosedOptions = async (market?: string): Promise<ClosedOption[]> =>
  request(`/closed-options${market ? `?market=${encodeURIComponent(market)}` : ''}`)

export const addClosedOption = async (item: {
  underlying_code: string
  contract_code: string
  market: string
  option_type?: string
  direction?: string
  strike_price?: number
  open_date?: string
  close_date?: string
  contracts: number
  multiplier?: number
  open_premium?: number
  close_premium?: number
  fee?: number
  notes?: string
}): Promise<{ success: boolean; id: number }> =>
  postRequest('/closed-options', item)

export const updateClosedOption = async (id: number, item: {
  underlying_code?: string
  contract_code?: string
  market?: string
  option_type?: string
  direction?: string
  strike_price?: number
  open_date?: string
  close_date?: string
  contracts?: number
  multiplier?: number
  open_premium?: number
  close_premium?: number
  fee?: number
  notes?: string
}): Promise<{ success: boolean; id: number }> =>
  putRequest(`/closed-options/${id}`, item)

export const deleteClosedOption = async (id: number): Promise<{ success: boolean; id: number }> =>
  deleteRequest(`/closed-options/${id}`)

export const screenStocks = async (params: {
  market: string
  start_year: number
  end_year?: number
  gross_margin_min?: string | number
  net_margin_min?: string | number
  revenue_yoy_min?: string | number
}): Promise<ScreenerResponse> => {
  const query = new URLSearchParams()
  query.set('market', params.market)
  query.set('start_year', String(params.start_year))
  if (params.end_year) query.set('end_year', String(params.end_year))
  if (params.gross_margin_min) query.set('gross_margin_min', String(params.gross_margin_min))
  if (params.net_margin_min) query.set('net_margin_min', String(params.net_margin_min))
  if (params.revenue_yoy_min) query.set('revenue_yoy_min', String(params.revenue_yoy_min))

  // A-share fetches full market data (5000+ stocks x N years), can take several minutes
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 5 * 60 * 1000) // 5 min timeout

  try {
    const response = await fetch(`${API_BASE_URL}/screener?${query.toString()}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
    clearTimeout(timeoutId)
    if (!response.ok) {
      throw new Error(`请求失败: ${response.status}`)
    }
    return (await response.json()) as ScreenerResponse
  } catch (err: any) {
    clearTimeout(timeoutId)
    if (err.name === 'AbortError') {
      throw new Error('请求超时（超过5分钟），请缩小年份范围后重试')
    }
    throw err
  }
}
