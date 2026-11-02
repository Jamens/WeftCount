import { createHash, timingSafeEqual } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import { ErrorCode } from '@weftcount/shared'

/**
 * 常量时间比较，避免按字符比对泄露口令前缀长度/内容。
 * 先做 sha256 是为了让两侧长度一致（timingSafeEqual 长度不等会抛异常）。
 */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a, 'utf8').digest()
  const hb = createHash('sha256').update(b, 'utf8').digest()
  return timingSafeEqual(ha, hb)
}

/**
 * API 文档页的 Basic Auth 中间件。
 *
 * Swagger 文档会把**全部接口结构**暴露出去（路径、参数、字段），
 * 生产环境公网可达时等于给攻击者一份现成的攻击面地图，
 * 所以生产默认不注册文档；确实要开就配上 Basic Auth。
 *
 * 返回 null 表示没配账号密码 → 不加认证（仅限内网/本地）。
 */
export function createSwaggerBasicAuth(
  user: string | undefined,
  password: string | undefined,
): ((req: Request, res: Response, next: NextFunction) => void) | null {
  if (!user || !password) return null

  const expected = `Basic ${Buffer.from(`${user}:${password}`, 'utf8').toString('base64')}`

  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization
    if (header && safeEqual(header, expected)) {
      next()
      return
    }
    res.setHeader('WWW-Authenticate', 'Basic realm="WeftCount API Docs", charset="UTF-8"')
    res.status(401).json({
      code: ErrorCode.UNAUTHORIZED,
      message: '需要 Basic Auth 才能访问 API 文档',
      data: null,
      ts: Date.now(),
    })
  }
}
