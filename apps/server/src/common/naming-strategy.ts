import { DefaultNamingStrategy } from 'typeorm'

/** 驼峰 → 下划线：maxCompanies → max_companies */
function toSnake(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase()
}

/**
 * 列名命名策略：驼峰属性名 → 下划线列名
 *
 * 为什么不逐个在 @Column 上写 name:
 * - 漏写不会有编译错误，只在运行时表现为「Unknown column in 'field list'」
 * - 集中在这里转换，新增字段时不必重复想列名
 *
 * ## 坑：属性名里带数字时，两侧不会插下划线
 *
 * `pointsPer100SqYd` → `points_per100_sq_yd`（**不是** `points_per_100_sq_yd`）。
 * 迁移 SQL 是手写的，写错时编译期毫无察觉，跑完迁移建出列、
 * 然后每次查询都报 `Unknown column` —— 而那时候功能已经"做完了"。
 *
 * 两种规避方式：
 * 1. **属性名别带数字**（推荐）。`penaltyDensity` 而不是 `pointsPer100SqYd`，
 *    推导出的 `penalty_density` 干净，单位写进 JSDoc。
 * 2. 必须带数字时，用本文件的 toSnake 实算一遍再写进迁移，
 *    别凭手感拼下划线。
 *
 * 验证手段：迁移跑完后用 TypeORM 真读写一遍（事务内 + 回滚），
 * 别只看 information_schema 里列存在——列存在不代表名字对。
 */
export class WeftNamingStrategy extends DefaultNamingStrategy {
  columnName(propertyName: string, _customName: string | undefined, _embeddedPrefixes: string[]): string {
    return toSnake(propertyName)
  }

  /** 索引名统一下划线，便于按名字反查表与列 */
  indexName(tableOrName: string, columnNames: string[], where?: string): string {
    const cols = columnNames.map(toSnake).join('_')
    const base = `idx_${toSnake(tableOrName)}_${cols}`
    return where ? `${base}_where` : base
  }
}
