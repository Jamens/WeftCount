/**
 * 补货建议（确定性计算，**不依赖大模型**）
 *
 * 采购员真正需要的不是「库存偏低」这个提醒，而是「**该补多少、什么时候补**」。
 *
 * ## 口径
 * ```
 * 日均用量 = 观察窗口内的出库总量 / 观察天数      （来自真实出库流水，不拍脑袋）
 * 补货点   = 日均用量 × (提前期 + 采购周期) + 安全库存
 * 建议补货量 = max(0, 补货点 + 日均用量 × 采购周期 − 当前库存)
 * ```
 *
 * ## 为什么不用 EOQ
 * EOQ（经济订货批量）= `√(2 × 年需求量 × 订货成本 / 持有成本率×单价)`，
 * 需要**订货成本**与**持有成本率**两个参数——这两个值中小企业根本没人算得出来，
 * 填进去的是猜的，出来的批量也是假的。所以这里用**可解释的口径**：
 * 「补到覆盖（提前期+采购周期）的用量 + 安全库存」，采购员能自己核对。
 *
 * ## 边界
 * - **观察窗口内无出库** → 日均用量 = 0 → 补货点退化为安全库存，建议补货量 = 缺口。
 *   不猜用量（低频物料宁可不建议多补）。
 * - 当前库存 ≥ 补货点 → **不该补货**，返回 `shouldReorder: false`，
 *   避免「库存充足也来催采购」。
 */

export interface ReorderInput {
  /** 当前库存（主单位） */
  currentStock: number
  /** 安全库存（主单位）；0=未设 */
  safetyStock: number
  /** 观察窗口内的出库总量（主单位） */
  consumedQty: number
  /** 观察窗口天数 */
  windowDays: number
  /** 采购提前期（天）：下单到货 */
  leadTimeDays: number
  /** 采购周期（天）：两次下单间隔 */
  orderCycleDays: number
}

export interface ReorderSuggestion {
  /** 日均用量（主单位/天），观察窗口无出库时为 0 */
  dailyUsage: number
  /** 补货点：低于此值就应下单 */
  reorderPoint: number
  /** 建议补货量（主单位），已取下限 0 */
  suggestQty: number
  /** 是否真的该补货 */
  shouldReorder: boolean
  /** 提前期+采购周期合计天数 */
  coverDays: number
  /** 文字依据——让采购员能自己核对，不做黑箱 */
  basis: string
}

/** 默认采购提前期/周期（天）：物料未填时的缺省值 */
export const DEFAULT_LEAD_TIME_DAYS = 7
/** 日均用量的观察窗口（天） */
export const DEFAULT_USAGE_WINDOW_DAYS = 30

/**
 * 计算补货建议
 *
 * @param rounded 小数位（数量口径统一到3 位，与库存数量精度一致）
 */
export function computeReorderSuggestion(input: ReorderInput, rounded = 3): ReorderSuggestion {
  // 库存夹到 >=0：负库存是脏数据，不应据此算出「补货量 5」这种荒谬结果
  const current = Math.max(0, num(input.currentStock))
  const safety = Math.max(0, num(input.safetyStock))
  const windowDays = Math.max(1, num(input.windowDays))
  const consumed = Math.max(0, num(input.consumedQty))
  const lead = Math.max(0, num(input.leadTimeDays))
  const cycle = Math.max(0, num(input.orderCycleDays))

  // 日均用量：观察窗口无出库则为 0（宁可不建议多补，也不臆造用量）
  const dailyUsage = consumed / windowDays
  const coverDays = lead + cycle

  // 补货点：覆盖「提前期 + 采购周期」的用量 + 安全库存
  const reorderPoint = dailyUsage * coverDays + safety
  // 建议补货量：补到「补货点 + 一个采购周期的用量」，扣掉现有库存，下限 0
  const target = reorderPoint + dailyUsage * cycle
  const shouldReorder = current < reorderPoint
  // **库存已够时必须给 0**——否则会出现「不建议补货，却建议补 130」的自相矛盾
  const suggestQty = shouldReorder ? Math.max(0, target - current) : 0

  const basis =
    dailyUsage > 0
      ? `近 ${windowDays} 天出库 ${fmtNum(consumed)} → 日均 ${fmtNum(dailyUsage)}/天；` +
        `补货点 = 日均 × (提前期 ${fmtNum(lead)} + 采购周期 ${fmtNum(cycle)}) + 安全库存 ${fmtNum(safety)} = ${fmtNum(reorderPoint)}；` +
        (shouldReorder
          ? `建议补货 = 补到 ${fmtNum(target)} − 现有 ${fmtNum(current)} = ${fmtNum(suggestQty)}`
          : `现有 ${fmtNum(current)} ≥ 补货点 ${fmtNum(reorderPoint)}，暂无需补货`)
      : `近 ${windowDays} 天无出库记录，日均用量按 0 计（不臆造）；` +
        `补货点退化为安全库存 ${fmtNum(safety)}；` +
        `建议补货 = ${fmtNum(safety)} − 现有 ${fmtNum(current)} = ${fmtNum(suggestQty)}`

  return {
    dailyUsage: round(dailyUsage, 4),
    reorderPoint: round(reorderPoint, rounded),
    suggestQty: round(suggestQty, rounded),
    shouldReorder,
    coverDays: round(coverDays, 2),
    basis,
  }
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function round(v: number, scale: number): number {
  const f = 10 ** scale
  return Math.round(v * f) / f
}

function fmtNum(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(2)
}