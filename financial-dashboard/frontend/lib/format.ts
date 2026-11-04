const CURRENCY_UNITS: Record<string, { yi: string; wan: string }> = {
  CNY: { yi: '亿元', wan: '万元' },
  USD: { yi: '亿美元', wan: '万美元' },
  HKD: { yi: '亿港元', wan: '万港元' },
}

export const formatNumber = (num: number | null | undefined): string => {
  if (num === null || num === undefined) return '-'
  return num.toLocaleString('zh-CN')
}

export const formatCurrency = (
  num: number | null | undefined,
  currency = 'CNY'
): string => {
  if (num === null || num === undefined) return '-'
  const units = CURRENCY_UNITS[currency] || CURRENCY_UNITS.CNY
  const yi = num / 100000000
  if (Math.abs(yi) >= 1) {
    return yi.toFixed(2) + ' ' + units.yi
  }
  const wan = num / 10000
  return wan.toFixed(2) + ' ' + units.wan
}

export const formatPercent = (num: number | null | undefined): string => {
  if (num === null || num === undefined) return '-'
  return num.toFixed(2) + '%'
}

export const formatCurrencyName = (currency?: string | null): string => {
  const names: Record<string, string> = {
    CNY: '人民币',
    USD: '美元',
    HKD: '港元',
  }
  return names[currency || 'CNY'] || '人民币'
}

export const formatGrowth = (num: number | null | undefined): string => {
  if (num === null || num === undefined) return '-'
  const prefix = num > 0 ? '+' : ''
  return prefix + num.toFixed(2) + '%'
}

export const growthColor = (num: number | null | undefined): string => {
  if (num === null || num === undefined) return 'text-gray-400'
  // 中国股市习惯：红涨绿跌
  return num >= 0 ? 'text-red-600' : 'text-green-600'
}
