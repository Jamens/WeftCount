import { useMemo } from 'react'

/**
 * 排产甘特图（零依赖 SVG）
 *
 * 不引第三方甘特/图表库：数据是「机台 × 时间区间的矩形」，SVG 直接画最可控，
 * 且与项目 Charts.tsx 的零依赖风格一致。
 *
 * 纵轴=机台，横轴=相对今天的天数；每个矩形一条工单占用。
 * 三态用颜色区分（见 BAR_FILL），逾期用红色左边框标出：
 * 让计划员一眼看出「哪台机满了、哪些单会逾期」。
 *
 * 交互：hover 显示 tooltip（原生 title，零依赖）。
 */

export interface GanttBarInput {
  orderId: string
  orderNo: string
  specName: string
  machineId: string | null
  startDay: number
  endDay: number
  status: 'in_progress' | 'scheduled' | 'draft'
  meetsDue: boolean | null
}

export interface GanttMachineInput {
  id: string
  name: string
  code: string
  loadDays: number
}

/** 三态配色：实心=已确认占用，浅色带虚线边=待排建议 */
const BAR_FILL: Record<GanttBarInput['status'], { fill: string; stroke: string; dash?: string; label: string }> = {
  in_progress: { fill: '#0F6E56', stroke: '#0B5642', label: '在产' },
  scheduled: { fill: '#185FA5', stroke: '#12447B', label: '已排产' },
  draft: { fill: '#E8F1FA', stroke: '#185FA5', dash: '4 3', label: '建议' },
}

const ROW_H = 34
const BAR_H = 20
const LEFT_W = 132
const TOP_H = 28
/** X 轴标签间隔（天）：跨度大时稀释，防文字重叠 */
function tickStep(span: number): number {
  if (span <= 7) return 1
  if (span <= 16) return 2
  if (span <= 40) return 5
  if (span <= 90) return 10
  return 20
}

export function GanttChart({
  machines,
  bars,
  horizonDays,
}: {
  machines: GanttMachineInput[]
  bars: GanttBarInput[]
  /** 时间轴总跨度（天），留空则按数据最大值 */
  horizonDays?: number
}) {
  // 甘特宽度随跨度自适应：用固定 viewBox 让 SVG 整体缩放，避免横向滚动条；
  // minWidth 保底 640px，防小屏下图上文字缩成一团。
  const span = Math.max(horizonDays ?? 0, ...bars.map((b) => b.endDay), 1)
  const width = 900
  const chartW = width - LEFT_W - 12
  const innerH = Math.max(machines.length, 1) * ROW_H
  const svgH = TOP_H + innerH + 8
  const step = tickStep(span)
  const pxPerDay = chartW / span

  // 提前算好刻度位置，X 轴每 step 天打一个标签
  const ticks = useMemo(() => {
    const out: number[] = []
    for (let d = 0; d <= span; d += step) out.push(d)
    return out
  }, [span, step])

  if (machines.length === 0) {
    return (
      <div style={{ padding: '24px 0', textAlign: 'center', color: 'rgba(0,0,0,0.45)', fontSize: 13 }}>
        暂无可用机台（idle/running），无法生成甘特图
      </div>
    )
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${width} ${svgH}`} style={{ width: '100%', minWidth: 640, display: 'block' }} role="img" aria-label="排产甘特图">
        {/* 时间轴刻度 */}
        {ticks.map((d) => {
          const x = LEFT_W + d * pxPerDay
          return (
            <g key={d}>
              <line x1={x} y1={TOP_H - 6} x2={x} y2={TOP_H + innerH} stroke="#E8E8E8" strokeWidth={1} />
              <text x={x} y={TOP_H - 11} fontSize={10} fill="#8C8C8C" textAnchor="middle">
                {d === 0 ? '今天' : `+${d}d`}
              </text>
            </g>
          )
        })}

        {/* 机台行 */}
        {machines.map((m, i) => {
          const y = TOP_H + i * ROW_H
          const rowBars = bars.filter((b) => b.machineId === m.id)
          return (
            <g key={m.id}>
              {/* 行底色交替 + 行标签 */}
              {i % 2 === 1 && <rect x={LEFT_W} y={y} width={chartW} height={ROW_H} fill="#FAFAFA" />}
              <text x={0} y={y + ROW_H / 2 + 4} fontSize={12} fill="#262626">
                {m.name}
              </text>
              <text x={0} y={y + ROW_H / 2 + 16} fontSize={10} fill="#8C8C8C">
                {m.code} · 负载{m.loadDays}d
              </text>
              {/* 行分隔线 */}
              <line x1={LEFT_W} y1={y + ROW_H} x2={LEFT_W + chartW} y2={y + ROW_H} stroke="#F0F0F0" />

              {/* 工单占用条：同一机台上按 startDay 排序，同层堆叠避免重叠 */}
              {rowBars
                .slice()
                .sort((a, b) => a.startDay - b.startDay)
                .map((b, idx) => {
                  const cfg = BAR_FILL[b.status]
                  const x = LEFT_W + b.startDay * pxPerDay
                  // 最小宽度保证极短工单（不足1天）也能看见
                  const w = Math.max((b.endDay - b.startDay) * pxPerDay, 3)
                  const isOverdue = b.meetsDue === false
                  // 同一机台内错开上下两层，最多两层
                  const lane = idx % 2
                  const barY = y + (lane === 0 ? 5 : 5 + BAR_H + 1)
                  return (
                    <g key={b.orderId}>
                      <rect
                        x={x}
                        y={barY}
                        width={w}
                        height={BAR_H}
                        rx={3}
                        fill={cfg.fill}
                        stroke={isOverdue ? '#CF1322' : cfg.stroke}
                        strokeWidth={isOverdue ? 2 : 1}
                        strokeDasharray={cfg.dash}
                      >
                        <title>{`${b.orderNo} · ${b.specName}\n第${b.startDay}~${b.endDay}天（${(b.endDay - b.startDay).toFixed(1)}d）· ${cfg.label}${isOverdue ? ' · 逾期风险' : ''}`}</title>
                      </rect>
                      {/* 条宽够时把工单号画进去，否则靠 hover 看 */}
                      {w > 54 && (
                        <text
                          x={x + 5}
                          y={barY + BAR_H / 2 + 4}
                          fontSize={10}
                          fill={b.status === 'draft' ? '#185FA5' : '#fff'}
                          style={{ pointerEvents: 'none' }}
                        >
                          {b.orderNo.slice(-8)}
                        </text>
                      )}
                    </g>
                  )
                })}
            </g>
          )
        })}
      </svg>

      {/* 图例 */}
      <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 12, color: 'rgba(0,0,0,0.65)' }}>
        {(Object.keys(BAR_FILL) as (keyof typeof BAR_FILL)[]).map((k) => (
          <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                width: 14,
                height: 10,
                background: BAR_FILL[k].fill,
                border: `1px ${BAR_FILL[k].dash ? 'dashed' : 'solid'} ${BAR_FILL[k].stroke}`,
                borderRadius: 2,
                display: 'inline-block',
              }}
            />
            {BAR_FILL[k].label}
          </span>
        ))}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 14, height: 10, background: 'transparent', border: '2px solid #CF1322', borderRadius: 2, display: 'inline-block' }} />
          逾期风险
        </span>
      </div>
    </div>
  )
}