import { BadRequestException } from '@nestjs/common'

/** 判断是否 MySQL 唯一键冲突（1062 / ER_DUP_ENTRY） */
export function isDuplicateEntryError(e: unknown): boolean {
  const err = e as { code?: string; errno?: number; driverError?: { code?: string }; message?: string }
  return (
    err?.code === 'ER_DUP_ENTRY' ||
    err?.errno === 1062 ||
    err?.driverError?.code === 'ER_DUP_ENTRY' ||
    /Duplicate entry/i.test(err?.message ?? '')
  )
}

/**
 * 撞号重试：并发创建单据时，两个请求可能「查最后单号→+1」拿到同一个号，撞唯一键(1062)。
 * 这里在唯一键冲突时**退避后重取号重试**；非冲突错误直接抛出。
 *
 * 退避很关键：多个并发都读同一个「最后号」生成同号，一个成功其余撞号；若立刻重试，
 * 成功者可能尚未提交，重试又读到旧号再次相撞。递增小延迟让重试错开、给胜者提交时间。
 *
 * 典型用法：把「生成号 + 落库」整体包起来（buildAndSave 每次重新取号）。
 */
export async function withUniqueNo<T>(
  buildAndSave: (attempt: number) => Promise<T>,
  maxRetry = 8,
): Promise<T> {
  let lastErr: unknown
  for (let attempt = 0; attempt < maxRetry; attempt++) {
    try {
      return await buildAndSave(attempt)
    } catch (e) {
      if (!isDuplicateEntryError(e)) throw e
      lastErr = e
      // 递增退避 + 轻微抖动，让并发重试错开（避免再次同步相撞）
      const backoff = Math.min(5 * 2 ** attempt, 200)
      await new Promise((r) => setTimeout(r, backoff + Math.floor(Math.random() * 20)))
    }
  }
  throw new BadRequestException({
    code: 'VALIDATION_FAILED',
    message: '单号生成冲突（并发过高），请重试',
  })
  void lastErr
}
