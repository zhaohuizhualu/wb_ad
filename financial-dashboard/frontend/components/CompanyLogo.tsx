'use client'

import { useEffect, useState } from 'react'

interface CompanyLogoProps {
  name: string
  logoUrl?: string | null
  size?: 'sm' | 'lg'
}

export default function CompanyLogo({
  name,
  logoUrl,
  size = 'lg',
}: CompanyLogoProps) {
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
  }, [logoUrl])

  const boxClass =
    size === 'sm' ? 'h-14 w-14 text-2xl rounded-xl' : 'h-24 w-24 text-4xl rounded-2xl'

  if (logoUrl && !failed) {
    return (
      <img
        src={logoUrl}
        alt={`${name} logo`}
        className={`${boxClass} object-contain`}
        onError={() => setFailed(true)}
      />
    )
  }

  return (
    <div
      className={`${boxClass} flex items-center justify-center bg-gradient-to-br from-blue-600 to-blue-900 font-bold text-white shadow-sm`}
      aria-label={`${name} logo`}
    >
      {name ? name.slice(0, 1) : '?'}
    </div>
  )
}
