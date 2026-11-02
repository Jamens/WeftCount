import { describe, expect, it } from 'vitest'
import {
  parseBool,
  parseOriginList,
  parsePositiveInt,
  resolveCorsConfig,
  resolveDbPassword,
  resolveSwaggerConfig,
  resolveTrustProxy,
} from './security-env'

describe('parseBool', () => {
  it('未配置时用兜底值', () => {
    expect(parseBool(undefined, true)).toBe(true)
    expect(parseBool(undefined, false)).toBe(false)
  })

  it('识别常见真值写法', () => {
    for (const v of ['1', 'true', 'TRUE', 'yes', 'on', ' true ']) {
      expect(parseBool(v, false)).toBe(true)
    }
  })

  it('识别常见假值写法', () => {
    for (const v of ['0', 'false', 'FALSE', 'no', 'off', ' false ']) {
      expect(parseBool(v, true)).toBe(false)
    }
  })

  it('空串与非法值退回兜底值', () => {
    expect(parseBool('', true)).toBe(true)
    expect(parseBool('maybe', true)).toBe(true)
    expect(parseBool('maybe', false)).toBe(false)
  })
})

describe('parsePositiveInt', () => {
  it('未配置或空串时用兜底值', () => {
    expect(parsePositiveInt(undefined, 1200, 'X')).toBe(1200)
    expect(parsePositiveInt('   ', 1200, 'X')).toBe(1200)
  })

  it('解析合法正整数', () => {
    expect(parsePositiveInt('300', 1200, 'X')).toBe(300)
    expect(parsePositiveInt(' 60 ', 1200, 'X')).toBe(60)
  })

  it('非法值直接抛错而不是静默退回默认值', () => {
    expect(() => parsePositiveInt('abc', 1200, 'RATE_LIMIT_MAX')).toThrow(/RATE_LIMIT_MAX/)
    expect(() => parsePositiveInt('0', 1200, 'RATE_LIMIT_MAX')).toThrow(/RATE_LIMIT_MAX/)
    expect(() => parsePositiveInt('-5', 1200, 'RATE_LIMIT_MAX')).toThrow(/RATE_LIMIT_MAX/)
  })
})

describe('parseOriginList', () => {
  it('拆分逗号并去掉空白', () => {
    expect(parseOriginList('http://a.com, http://b.com')).toEqual(['http://a.com', 'http://b.com'])
  })

  it('去掉尾部斜杠，避免与浏览器实际来源不匹配', () => {
    expect(parseOriginList('http://a.com/')).toEqual(['http://a.com'])
  })

  it('过滤空项', () => {
    expect(parseOriginList('http://a.com,,  ,')).toEqual(['http://a.com'])
    expect(parseOriginList(undefined)).toEqual([])
    expect(parseOriginList('')).toEqual([])
  })
})

describe('resolveCorsConfig', () => {
  it('显式配置逗号列表时按精确白名单放行', () => {
    const cfg = resolveCorsConfig('http://a.com,http://b.com', true)
    expect(cfg.allowAll).toBe(false)
    expect(cfg.origins).toEqual(['http://a.com', 'http://b.com'])
  })

  it('配置 * 时放行任意来源', () => {
    const cfg = resolveCorsConfig('*', true)
    expect(cfg.allowAll).toBe(true)
  })

  it('生产未配置时拒绝一切跨源', () => {
    const cfg = resolveCorsConfig(undefined, true)
    expect(cfg.allowAll).toBe(false)
    expect(cfg.origins).toEqual([])
  })

  it('开发未配置时放行本机管理端端口', () => {
    const cfg = resolveCorsConfig(undefined, false)
    expect(cfg.allowAll).toBe(false)
    expect(cfg.origins).toContain('http://localhost:5180')
    expect(cfg.origins).toContain('http://127.0.0.1:5180')
  })
})

describe('resolveSwaggerConfig', () => {
  it('生产默认关闭，开发默认开启', () => {
    expect(resolveSwaggerConfig(undefined, undefined, undefined, true).enabled).toBe(false)
    expect(resolveSwaggerConfig(undefined, undefined, undefined, false).enabled).toBe(true)
  })

  it('显式配置优先于环境默认值', () => {
    expect(resolveSwaggerConfig('true', undefined, undefined, true).enabled).toBe(true)
    expect(resolveSwaggerConfig('false', undefined, undefined, false).enabled).toBe(false)
  })

  it('读取 Basic Auth 账号，空串视为未配置', () => {
    const cfg = resolveSwaggerConfig('true', 'admin', '  ', true)
    expect(cfg.user).toBe('admin')
    expect(cfg.password).toBeUndefined()
  })
})

describe('resolveTrustProxy', () => {
  it('默认信任一跳（nginx → server 拓扑）', () => {
    expect(resolveTrustProxy(undefined)).toBe(1)
    expect(resolveTrustProxy('')).toBe(1)
  })

  it('数字串解析成数字', () => {
    expect(resolveTrustProxy('2')).toBe(2)
    expect(resolveTrustProxy('0')).toBe(0)
  })

  it('非数字按 Express 的信任表达式透传', () => {
    expect(resolveTrustProxy('loopback')).toBe('loopback')
  })
})

describe('resolveDbPassword', () => {
  it('缺失时抛错，不再有内置明文兜底', () => {
    expect(() => resolveDbPassword(undefined, false)).toThrow(/DB_PASSWORD/)
    expect(() => resolveDbPassword('   ', true)).toThrow(/DB_PASSWORD/)
  })

  it('生产环境拒绝仓库里的公开示例值', () => {
    expect(() => resolveDbPassword('1234560', true)).toThrow(/DB_PASSWORD/)
    expect(() => resolveDbPassword('weft_change_me', true)).toThrow(/DB_PASSWORD/)
  })

  it('开发环境允许沿用本地 .env 里的既有口令', () => {
    expect(resolveDbPassword('1234560', false)).toBe('1234560')
  })

  it('正常口令原样返回（去掉首尾空白）', () => {
    expect(resolveDbPassword('  s3cret  ', true)).toBe('s3cret')
  })
})
