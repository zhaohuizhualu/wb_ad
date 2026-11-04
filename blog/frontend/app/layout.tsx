import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '我的博客',
  description: '工作记录与技术笔记',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-CN">
      <body className="bg-gray-50 text-gray-900 antialiased">{children}</body>
    </html>
  )
}
