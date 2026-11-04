import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '公司财务数据平台',
  description: '上市公司核心财务指标展示',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-CN">
      <body>
        <nav className="border-b border-gray-200 bg-white">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
            <a href="/" className="text-lg font-bold text-gray-900 hover:text-blue-700">
              财务数据平台
            </a>
            <div className="flex gap-6 text-sm">
              <a
                href="/"
                className="text-gray-600 hover:text-blue-600 hover:underline"
              >
                公司列表
              </a>
              <a
                href="/portfolio"
                className="text-gray-600 hover:text-blue-600 hover:underline"
              >
                我的资产
              </a>
            </div>
          </div>
        </nav>
        {children}
      </body>
    </html>
  )
}
