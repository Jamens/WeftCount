/**
 * 日期工具（date-only 语义）
 *
 * ## 为什么要单独一个模块
 *
 * MySQL 的 `date` 列（无时分秒）经 mysql2 驱动读回时是 **本地时区的 Date 对象**：
 * 库里存 `2027-02-12`，驱动回的是 `2027-02-12 00:00:00 +08:00`。
 *
 * 若直接用 `toISOString().slice(0, 10)` 取日期，会先转成 UTC —— 东八区的本地午夜
 * 正是 UTC 前一天 16:00，于是 `2027-02-12` 被读成 **`2027-02-11`**，
 * **整整差一天**。这不是显示问题：期间筛选、到期日推算、单耗归期、账龄全都会算错。
 *
 * 反过来，写入侧若用 `new Date('2027-02-12')`（不带时间部分），
 * JS 规范把它当 **UTC 午夜** 解析，本地时区下又会偏到前一天 16:00，同样差一天。
 *
 * 所以本项目对「日期」一律走两条路：
 * - `dateToISO(v)`：把驱动回读的对象/字符串安全转成 `YYYY-MM-DD`（按**本地**日历日）
 * - `isoToDate(s)`：把 `YYYY-MM-DD` 解析成**本地**零点的 Date，用于做日期加减
 *
 * 统一用本地日历日语义，才对得上「某人 4 月 1 日做的保养，4 月 8 日到期」这种业务表达。
 */

/** 把 Date / 字符串转成 `YYYY-MM-DD`（按本地日历日，避免 toISOString 的 UTC 偏移） */
export function dateToISO(v: unknown): string {
  if (v == null) return ''
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return ''
    const y = v.getFullYear()
    const m = String(v.getMonth() + 1).padStart(2, '0')
    const d = String(v.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  return String(v).slice(0, 10)
}

/**
 * 把 `YYYY-MM-DD` 解析成**本地**零点的 Date。
 *
 * 不能用 `new Date('2027-02-12')`——那会按 UTC 午夜解析，在东八区偏到前一天 16:00。
 */
export function isoToDate(isoDate: string): Date {
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0)
}

/** 日期平移（天），返回 `YYYY-MM-DD`。按本地日历日加减，跨月跨年正确 */
export function dayShift(isoDate: string, days: number): string {
  const d = isoToDate(isoDate)
  d.setDate(d.getDate() + days)
  return dateToISO(d)
}

/** 两个 `YYYY-MM-DD` 之间的整天数（a - b）。按本地日历日算，不受夏令时/时区影响 */
export function dayDiffISO(a: string, b: string): number {
  const ms = 24 * 60 * 60 * 1000
  return Math.round((isoToDate(a).getTime() - isoToDate(b).getTime()) / ms)
}

/** 今天（本地日历日）`YYYY-MM-DD` */
export function today(): string {
  return dateToISO(new Date())
}
