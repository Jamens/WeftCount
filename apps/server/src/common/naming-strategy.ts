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
