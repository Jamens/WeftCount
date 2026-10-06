import { useMemo } from 'react'

/**
 * 轻量 SVG 图表（零依赖）
 *
 * 不引第三方图表库：数据简单（时间序列数值），自建可控且与项目风格统一。
 * 图表只做「确定性聚合结果」的可视化，不做预测/平滑。

 * 注意：所有 chart 用 viewBox + width:100% 自适应；X 轴稀疏打标签防拥挤。
 */

export interface SeriesPoint {
  label: string
  values: number[]
}

const PALETTE = ['#0F6E56', '#185FA5', '#BA7517', '#993C1D', '#534AB7', '#A32D2D']

function niceMax(v: number): number {
  if (v <= 0) return 1
  const mag = Math.pow(10, Math.floor(Math.log10(v)))
  const n = v / mag
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10
  return step * mag
}

function fmtNum(v: number): string {
  if (v >= 1e8) return (v / 1e8).toFixed(1) + '亿'
  if (v >= 1e4) return (v / 1e4).toFixed(1) + '万'
  if (v >= 1000) return (v / 1000).toFixed(1) + 'k'
  if (Number.isInteger(v)) return String(v)
  return v.toFixed(1)
}

/**
 * 折线/面积图：多条 series 叠加。data 为按 x 顺序的标签与各系列数值。
 */
export function LineChart({
  data,
  seriesNames,
  height = 220,
  area = true,
}: {
  data: SeriesPoint[]
  seriesNames: string[]
  height?: number
  area?: boolean
}) {
  const W = 720
  const H = height
  const padL = 48
  const padR = 16
  const padT = 12
  const padB = 28
  const iw = W - padL - padR
  const ih = H - padT - padB

  const { paths, areaPaths, gridY, ticks } = useMemo(() => {
    let maxV = 0
    for (const p of data) for (const v of p.values) if (v > maxV) maxV = v
    maxV = niceMax(maxV)
    const n = data.length
    const xAt = (i: number) => padL + (n <= 1 ? iw / 2 : (i * iw) / (n - 1))
    const yAt = (v: number) => padT + ih - (v / maxV) * ih
    const paths: string[] = []
    const areaPaths: string[] = []
    for (let s = 0; s < seriesNames.length; s++) {
      const pts = data.map((p, i) => `${xAt(i)},${yAt(p.values[s] ?? 0)}`)
      paths.push(pts.length ? `M${pts.join('L')}` : '')
      if (area && s === 0 && pts.length) {
        areaPaths.push(`M${xAt(0)},${padT + ih}L${pts.join('L')}L${xAt(n - 1)},${padT + ih}Z`)
      }
    }
    const gridY = [0, maxV / 2, maxV].map((v) => ({ v, y: yAt(v) }))
    const ticks = data.map((p, i) => ({ label: p.label, x: xAt(i) }))
    return { maxV, paths, areaPaths, xAt, gridY, ticks }
  }, [data, seriesNames, ih, iw])

  if (!data.length) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>暂无数据</div>
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" style={{ display: 'block' }}>
      {/* 网格线 + Y 轴刻度 */}
      {gridY.map((g) => (
        <g key={g.v}>
          <line x1={padL} x2={W - padR} y1={g.y} y2={g.y} stroke="#e8e8e8" strokeWidth={1} />
          <text x={padL - 8} y={g.y} textAnchor="end" dominantBaseline="central" fontSize={11} fill="#8c8c8c">
            {fmtNum(g.v)}
          </text>
        </g>
      ))}
      {/* 面积（仅首个系列） */}
      {areaPaths.map((d, i) => (
        <path key={i} d={d} fill={PALETTE[0]} opacity={0.08} />
      ))}
      {/* 折线 */}
      {paths.map((d, i) => (
        <path key={i} d={d} fill="none" stroke={PALETTE[i % PALETTE.length]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      ))}
      {/* X 轴标签（首/中/尾，防拥挤） */}
      {ticks.map((t, i) => {
        if (i !== 0 && i !== ticks.length - 1 && i !== Math.floor(ticks.length / 2)) return null
        return (
          <text key={i} x={t.x} y={H - 8} textAnchor="middle" fontSize={11} fill="#8c8c8c">
            {t.label}
          </text>
        )
      })}
    </svg>
  )
}

/** 图例 */
export function Legend({ names }: { names: string[] }) {
  return (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 4 }}>
      {names.map((n, i) => (
        <span key={n} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#555' }}>
          <span style={{ width: 12, height: 3, borderRadius: 2, background: PALETTE[i % PALETTE.length] }} />
          {n}
        </span>
      ))}
    </div>
  )
}

/**
 * 柱状图（纵向）：用于单系列按类目对比。
 */
export function BarChart({ data, height = 220, color = PALETTE[0] }: { data: SeriesPoint[]; height?: number; color?: string }) {
  const W = 720
  const H = height
  const padL = 48
  const padR = 16
  const padT = 12
  const padB = 28
  const iw = W - padL - padR
  const ih = H - padT - padB
  const n = data.length || 1
  const maxV = niceMax(Math.max(...data.map((d) => d.values[0] ?? 0), 0))
  const bw = Math.max(iw / n - 4, 2)
  const xAt = (i: number) => padL + (i * iw) / n
  const yAt = (v: number) => padT + ih - (v / maxV) * ih
  const gridY = [0, maxV / 2, maxV].map((v) => ({ v, y: yAt(v) }))

  if (!data.length) return <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>暂无数据</div>

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" style={{ display: 'block' }}>
      {gridY.map((g) => (
        <g key={g.v}>
          <line x1={padL} x2={W - padR} y1={g.y} y2={g.y} stroke="#e8e8e8" strokeWidth={1} />
          <text x={padL - 8} y={g.y} textAnchor="end" dominantBaseline="central" fontSize={11} fill="#8c8c8c">
            {fmtNum(g.v)}
          </text>
        </g>
      ))}
      {data.map((d, i) => {
        const v = d.values[0] ?? 0
        const y = yAt(v)
        return <rect key={i} x={xAt(i)} y={y} width={bw} height={padT + ih - y} fill={color} rx={2} />
      })}
      {data.map((d, i) => {
        if (i !== 0 && i !== data.length - 1 && i !== Math.floor(data.length / 2)) return null
        return (
          <text key={i} x={xAt(i) + bw / 2} y={H - 8} textAnchor="middle" fontSize={11} fill="#8c8c8c">
            {d.label}
          </text>
        )
      })}
    </svg>
  )
}

/**
 * 横向条形图：用于类目占比排行（规格产量占比等），类目名可读全。
 */
export function HBarChart({ data }: { data: SeriesPoint[] }) {
  const maxV = Math.max(...data.map((d) => d.values[0] ?? 0), 1)
  const rowH = 28
  const W = 720
  const H = Math.max(data.length * rowH + 8, 40)
  const labelW = 140
  const valW = 70
  const barW = W - labelW - valW - 16
  const total = data.reduce((s, d) => s + (d.values[0] ?? 0), 0)

  if (!data.length) return <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>暂无数据</div>

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" style={{ display: 'block' }}>
      {data.map((d, i) => {
        const v = d.values[0] ?? 0
        const y = i * rowH + 6
        const w = (v / maxV) * barW
        const pct = total > 0 ? ((v / total) * 100).toFixed(1) : '0'
        return (
          <g key={i}>
            <text x={labelW - 10} y={y + rowH / 2 - 6} textAnchor="end" dominantBaseline="central" fontSize={12} fill="#333">
              {d.label.length > 12 ? d.label.slice(0, 12) + '…' : d.label}
            </text>
            <rect x={labelW} y={y + 4} width={barW} height={rowH - 16} fill="#f0f0f0" rx={3} />
            <rect x={labelW} y={y + 4} width={Math.max(w, 1)} height={rowH - 16} fill={PALETTE[i % PALETTE.length]} rx={3} />
            <text x={W - 8} y={y + rowH / 2 - 6} textAnchor="end" dominantBaseline="central" fontSize={11} fill="#666">
              {fmtNum(v)} ({pct}%)
            </text>
          </g>
        )
      })}
    </svg>
  )
}
