'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import Link from 'next/link'
import { getCompanies, addCompany, stockSearch, Company, StockSearchResult } from '@/lib/api'
import CompanyLogo from '@/components/CompanyLogo'

export default function Home() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // 添加新公司
  const [showAddForm, setShowAddForm] = useState(false)
  const [newCode, setNewCode] = useState('')
  const [newName, setNewName] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState('')
  const [addSuccess, setAddSuccess] = useState('')

  // 搜索联想
  const [searchResults, setSearchResults] = useState<StockSearchResult[]>([])
  const [showSearchDropdown, setShowSearchDropdown] = useState(false)
  const [searchLoading, setSearchLoading] = useState(false)
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const loadCompanies = async () => {
    setLoading(true)
    setError('')
    try {
      const list = await getCompanies()
      setCompanies(list)
    } catch (err) {
      console.error('获取公司列表失败:', err)
      setError('公司列表加载失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadCompanies()
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
        }
      } catch (e) {
        // 静默失败
      }
    }, 200)
  }, [newCode, newName])

  const selectSearchResult = (result: StockSearchResult) => {
    setNewCode(result.code)
    setNewName(result.name)
    setShowSearchDropdown(false)
    setSearchResults([])
  }

  const handleAddCompany = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newCode.trim()) return
    setAdding(true)
    setAddError('')
    setAddSuccess('')
    try {
      const result = await addCompany({
        code: newCode.trim(),
        name: newName.trim(),
      })
      setAddSuccess(result.message)
      setNewCode('')
      setNewName('')
      setShowAddForm(false)
      await loadCompanies()
    } catch (err: any) {
      console.error('添加公司失败:', err)
      setAddError('添加失败: ' + (err?.message || String(err)))
    } finally {
      setAdding(false)
    }
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <header className="mb-10 text-center">
          <h1 className="text-2xl font-bold text-gray-900">公司财务数据</h1>
          <p className="mt-2 text-sm text-gray-500">点击公司 logo 查看财务数据详情</p>
        </header>

        {loading && (
          <div className="py-20 text-center text-gray-500">加载中...</div>
        )}

        {!loading && error && (
          <div className="py-20 text-center text-red-500">{error}</div>
        )}

        {!loading && !error && companies.length === 0 && (
          <div className="py-20 text-center text-gray-500">暂无公司数据</div>
        )}

        {!loading && !error && companies.length > 0 && (
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4">
            {companies.map((company) => (
              <Link
                key={company.code}
                href={`/company/${company.code}`}
                className="group flex flex-col items-center rounded-2xl border border-gray-100 bg-white px-4 py-8 shadow-sm transition hover:-translate-y-1 hover:border-blue-100 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                aria-label={`查看${company.name}财务数据`}
              >
                <CompanyLogo name={company.name} logoUrl={company.logo_url} />
                <div className="mt-5 text-center text-base font-semibold text-gray-900 group-hover:text-blue-700">
                  {company.name}
                </div>
              </Link>
            ))}

            {/* 添加新公司卡片 */}
            <button
              onClick={() => {
                setShowAddForm(true)
                setAddError('')
                setAddSuccess('')
              }}
              className="group flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-gray-200 bg-white px-4 py-8 shadow-sm transition hover:-translate-y-1 hover:border-blue-300 hover:bg-blue-50 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-100 text-3xl text-blue-600 transition group-hover:bg-blue-200">
                +
              </div>
              <div className="mt-5 text-center text-base font-semibold text-gray-500 group-hover:text-blue-700">
                添加新公司
              </div>
            </button>
          </div>
        )}

        {/* 添加新公司弹窗 */}
        {showAddForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-bold text-gray-900">添加新公司</h2>
                <button
                  onClick={() => {
                    setShowAddForm(false)
                    setAddError('')
                    setAddSuccess('')
                  }}
                  className="text-2xl text-gray-400 hover:text-gray-600"
                >
                  ×
                </button>
              </div>

              {addError && (
                <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
                  {addError}
                </div>
              )}
              {addSuccess && (
                <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">
                  {addSuccess}
                </div>
              )}

              <form onSubmit={handleAddCompany} className="space-y-4">
                <div className="relative" ref={dropdownRef}>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    股票代码 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={newCode}
                    onChange={(e) => handleSearch(e.target.value)}
                    onBlur={handleCodeBlur}
                    placeholder="如: 600519 或 AAPL"
                    required
                    autoComplete="off"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  {showSearchDropdown && searchResults.length > 0 && (
                    <div className="absolute z-20 mt-1 w-full rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                      {searchResults.map((result, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => selectSearchResult(result)}
                          className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-blue-50"
                        >
                          <span>
                            <span className="font-semibold text-gray-900">{result.name}</span>
                            <span className="ml-2 text-gray-500">{result.code}</span>
                          </span>
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                            {result.market_type}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                  {searchLoading && (
                    <div className="absolute right-3 top-8 text-xs text-gray-400">搜索中...</div>
                  )}
                  <p className="mt-1 text-xs text-gray-500">
                    A股可省略后缀，美股/港股建议带后缀（如 .O/.HK）
                  </p>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    公司名称
                  </label>
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="留空将自动获取"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddForm(false)
                      setAddError('')
                    }}
                    className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={adding}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-blue-700 disabled:opacity-50"
                  >
                    {adding ? '添加中...' : '确认添加'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
