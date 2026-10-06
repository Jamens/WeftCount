/**
 * 离线队列（断网暂存 → 恢复后自动重放）
 *
 * 车间网络不稳是常态，扫码报工/出库不能因为断网就丢单。
 *
 * **只排队「网络类失败」，绝不排队「业务失败」**：
 * - 网络类（无响应 / 超时 / 连接被拒）→ 请求**根本没到服务端**，入队重放安全
 * - 业务类（4xx，如库存不足、规格不符、权限不足）→ 服务端已明确拒绝，
 *   重放只会再失败一次并刷屏，必须**立刻抛给操作员**，否则错误被「假装成功」掩盖。
 *
 * 重放安全性依赖服务端幂等键 `clientRequestId`：每条队列记录生成一次、
 * 重放时**复用同一个**，服务端据此去重，不会重复计量/重复出入库。
 */
import axios from 'axios'

/** 一条待重放的写操作 */
export interface QueuedOp {
  /** 本地唯一 id（队列内去重/追踪用） */
  id: string
  /** 人类可读描述，用于界面提示 */
  label: string
  method: 'POST' | 'PATCH' | 'PUT'
  path: string
  body: unknown
  /** 幂等键：重放时复用，服务端据此去重 */
  clientRequestId: string
  /** 入队时间戳 */
  queuedAt: number
  /** 重试次数（超过上限仍失败则停止重试，交人工处理） */
  attempts: number
  /** 最近一次失败原因 */
  lastError?: string
}

const QUEUE_KEY = 'weft_offline_queue'
/** 最多重试次数——超了就不再自动重放，避免无限重试打服务端 */
const MAX_ATTEMPTS = 8

function read(): QueuedOp[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY)
    return raw ? (JSON.parse(raw) as QueuedOp[]) : []
  } catch {
    return []
  }
}

function write(items: QueuedOp[]): void {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(items))
}

/**
 * 判断是否属于「网络类失败」——只有这类才值得排队重放。
 *
 * axios 的 `error.response` 存在 = 服务端有响应 = 业务错误（4xx/5xx）→ 不排队。
 * 无 response = 请求没送达（断网/超时/DNS/连接被拒）→ 排队。
 */
export function isNetworkError(e: unknown): boolean {
  if (axios.isAxiosError(e)) {
    if (e.response) return false // 服务端 responded → 业务错误
    return true // 无响应 → 网络类
  }
  const anyE = e as {
    code?: string
    message?: string
    isAxios?: boolean
    noResponse?: boolean
  }
  // 经 api.ts 响应拦截器包装的错误：noResponse=true 即「请求没到服务端」
  if (anyE?.isAxios) return anyE.noResponse === true
  if (anyE?.code === 'ERR_NETWORK' || anyE?.code === 'ECONNABORTED' || /timeout|network/i.test(anyE?.message ?? '')) {
    return true
  }
  return false
}

/** 生成幂等键（与 newReqId 同源格式） */
function newId(prefix = 'q'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export const offlineQueue = {
  /** 入队一条写操作；返回队列里的这条记录 */
  enqueue(op: Omit<QueuedOp, 'id' | 'queuedAt' | 'attempts'>): QueuedOp {
    const item: QueuedOp = { ...op, id: newId(), queuedAt: Date.now(), attempts: 0 }
    const items = read()
    // 同一 path+body 不重复入队（避免用户连点多次产生多条相同待同步）
    const dup = items.find(
      (x) => x.path === item.path && JSON.stringify(x.body) === JSON.stringify(item.body),
    )
    if (dup) return dup
    items.push(item)
    write(items)
    return item
  },

  list(): QueuedOp[] {
    return read()
  },

  count(): number {
    return read().length
  },

  remove(id: string): void {
    write(read().filter((x) => x.id !== id))
  },

  clear(): void {
    localStorage.removeItem(QUEUE_KEY)
  },

  /**
   * 重放队列（顺序串行）。
   *
   * - **幂等键复用**：重放时把 `clientRequestId` 塞回 body，服务端去重，
   *   所以即使首次其实成功、只是响应丢了，重放也只会拿到首次结果，不会重复执行。
   * - 成功或达到重试上限 → 出队；网络类失败 → 增加 attempts 留待下次；
   *   业务类失败 → **直接丢弃**（重试无用，且错误已被服务端明确拒绝）。
   *
   * @param send 由调用方注入的发送函数（用项目的 api 实例，保持认证/错误解包一致）
   */
  async flush(send: (op: QueuedOp) => Promise<void>): Promise<{ done: number; failed: number }> {
    const items = read()
    let done = 0
    let failed = 0
    for (const op of items) {
      if (op.attempts >= MAX_ATTEMPTS) {
        this.remove(op.id)
        failed++
        continue
      }
      try {
        await send(op)
        this.remove(op.id)
        done++
      } catch (e) {
        if (isNetworkError(e)) {
          // 还可能是网络问题：留队，下轮再试
          const items2 = read().map((x) =>
            x.id === op.id ? { ...x, attempts: x.attempts + 1, lastError: (e as Error)?.message } : x,
          )
          write(items2)
        } else {
          // 业务错误：重试无用，直接丢弃（否则错误被队列无限重放掩盖）
          this.remove(op.id)
          failed++
        }
      }
    }
    return { done, failed }
  },
}

/** 网络状态（供 UI 提示） */
export const netStatus = {
  isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  lastSyncAt: 0 as number,
}