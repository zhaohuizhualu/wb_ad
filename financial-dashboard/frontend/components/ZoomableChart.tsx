'use client'

import { ReactElement, ReactNode, useEffect, useState } from 'react'
import { ReferenceArea, ResponsiveContainer } from 'recharts'

type ChartDatum = Record<string, any>

interface DragRange {
  start?: string | number
  end?: string | number
}

interface ChartHandlers {
  onMouseDown: (state?: any) => void
  onMouseMove: (state?: any) => void
  onMouseUp: (state?: any) => void
  onMouseLeave: () => void
}

interface ZoomableChartProps {
  data: ChartDatum[]
  xKey: string
  height?: number
  render: (args: {
    data: ChartDatum[]
    handlers: ChartHandlers
    selection: ReactNode
  }) => ReactElement
}

/**
 * 支持鼠标框选缩放的图表容器。
 * 在图表内按住左键横向拖拽，松开后只保留框选的时间段，Y 轴会自动重新缩放。
 */
export default function ZoomableChart({
  data,
  xKey,
  height = 400,
  render,
}: ZoomableChartProps) {
  const [fullData, setFullData] = useState<ChartDatum[]>(data)
  const [visibleData, setVisibleData] = useState<ChartDatum[]>(data)
  const [drag, setDrag] = useState<DragRange>({})

  // 数据刷新（切换公司 / 季度数据加载完成）时重置缩放
  useEffect(() => {
    setFullData(data)
    setVisibleData(data)
    setDrag({})
  }, [data])

  const zoomed = visibleData.length < fullData.length

  const indexOf = (label: string | number | undefined) => {
    if (label === undefined || label === null) return -1
    return visibleData.findIndex((item) => String(item[xKey]) === String(label))
  }

  const handleMouseDown = (state?: any) => {
    const label = state?.activeLabel
    if (label === undefined || label === null) return
    setDrag({ start: label, end: label })
  }

  const handleMouseMove = (state?: any) => {
    const label = state?.activeLabel
    if (drag.start === undefined || label === undefined || label === null) return
    setDrag((prev) => ({ ...prev, end: label }))
  }

  const handleMouseUp = (state?: any) => {
    const start = drag.start
    const end = state?.activeLabel ?? drag.end
    setDrag({})

    if (start === undefined || end === undefined) return
    const first = indexOf(start)
    const last = indexOf(end)
    if (first < 0 || last < 0 || first === last) return

    const [from, to] = first < last ? [first, last] : [last, first]
    if (to - from < 1) return
    setVisibleData((current) => current.slice(from, to + 1))
  }

  const handleMouseLeave = () => {
    if (drag.start !== undefined) setDrag({})
  }

  const selecting =
    drag.start !== undefined &&
    drag.end !== undefined &&
    String(drag.start) !== String(drag.end)

  const selection = selecting ? (
    <ReferenceArea
      x1={drag.start}
      x2={drag.end}
      fill="#6366f1"
      fillOpacity={0.15}
      strokeOpacity={0.3}
    />
  ) : null

  const handlers: ChartHandlers = {
    onMouseDown: handleMouseDown,
    onMouseMove: handleMouseMove,
    onMouseUp: handleMouseUp,
    onMouseLeave: handleMouseLeave,
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-end gap-2 text-xs text-gray-500">
        <span>按住鼠标左键在图中横向框选时间段可放大查看</span>
        <button
          type="button"
          onClick={() => setVisibleData(fullData)}
          disabled={!zoomed}
          className="rounded border border-gray-200 px-2 py-1 font-medium text-gray-600 transition hover:border-blue-300 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          重置缩放
        </button>
      </div>
      <div className="cursor-crosshair select-none">
        <ResponsiveContainer width="100%" height={height}>
          {render({ data: visibleData, handlers, selection })}
        </ResponsiveContainer>
      </div>
    </div>
  )
}
