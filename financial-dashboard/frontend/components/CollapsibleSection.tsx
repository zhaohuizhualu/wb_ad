'use client'

import { ReactNode, useState } from 'react'

interface CollapsibleSectionProps {
  title: string
  subtitle?: string
  defaultOpen?: boolean
  children: ReactNode
}

export default function CollapsibleSection({
  title,
  subtitle,
  defaultOpen = false,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <section className="mb-8 overflow-hidden rounded-lg bg-white shadow">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-4 px-6 py-4 text-left transition hover:bg-gray-50"
      >
        <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-xl font-bold">{title}</span>
          {subtitle && (
            <span className="text-sm font-normal text-gray-500">{subtitle}</span>
          )}
        </span>
        <svg
          className={`h-5 w-5 shrink-0 text-gray-400 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>
      {open && <div className="border-t border-gray-100">{children}</div>}
    </section>
  )
}
