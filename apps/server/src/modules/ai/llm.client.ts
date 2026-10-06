import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LlmResult {
  ok: boolean
  content: string
  /** 失败原因：no_api_key（未配 key）/ disabled（AI_ENABLED=false 总开关关闭）/ timeout / http_error / network_error / bad_json */
  reason?: string
  usage?: { promptTokens?: number; completionTokens?: number }
}

/**
 * 大模型客户端（DeepSeek / OpenAI 兼容）
 *
 * 只负责「理解意图 / 生成建议 / 解释原因」，**绝不参与任何数值计算**——
 * 数字全部来自确定性引擎，这里只做自然语言。
 *
 * 无 API key 或调用失败时返回 ok:false，由调用方走确定性规则兜底，
 * 保证 AI 不可用时系统仍能给出（规则版）结论，不整体瘫痪。
 */
@Injectable()
export class LlmClient {
  private readonly log = new Logger(LlmClient.name)

  constructor(private readonly config: ConfigService) {}

  /**
   * AI 总开关
   *
   * 三种关闭方式（任一命中即关闭），便于演示/离线/排障时一键停用大模型：
   *   1. `AI_ENABLED=false` 显式关闭（**优先**，即使配了 key 也不调用）
   *   2. 未配置 `AI_API_KEY`
   * 关闭时各AI 能力**照常返回确定性结果**（成本/价带/统计都是本地算的），
   * 只是不调用大模型改写建议——功能降级但不停摆。
   */
  get enabled(): boolean {
    const flag = this.config.get<string>('AI_ENABLED')
    if (flag != null && flag.trim().toLowerCase() === 'false') return false
    return !!this.config.get<string>('AI_API_KEY')
  }

  async chat(messages: LlmMessage[], opts?: { temperature?: number; timeoutMs?: number }): Promise<LlmResult> {
    if (!this.enabled) {
      return {
        ok: false,
        content: '',
        reason: this.config.get<string>('AI_API_KEY') ? 'disabled' : 'no_api_key',
      }
    }
    const apiKey = this.config.get<string>('AI_API_KEY')!
    const baseUrl = (this.config.get<string>('AI_BASE_URL') ?? 'https://api.deepseek.com').replace(/\/+$/, '')
    const model = this.config.get<string>('AI_MODEL') ?? 'deepseek-chat'
    const timeoutMs = opts?.timeoutMs ?? 20000
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages, temperature: opts?.temperature ?? 0.2 }),
        signal: controller.signal,
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        this.log.warn(`LLM HTTP ${res.status}: ${text.slice(0, 200)}`)
        return { ok: false, content: '', reason: 'http_error' }
      }
      const body = (await res.json()) as {
        choices?: { message?: { content?: string } }[]
        usage?: { prompt_tokens?: number; completion_tokens?: number }
      }
      const content = body.choices?.[0]?.message?.content ?? ''
      return {
        ok: !!content,
        content,
        reason: content ? undefined : 'bad_json',
        usage: { promptTokens: body.usage?.prompt_tokens, completionTokens: body.usage?.completion_tokens },
      }
    } catch (e) {
      const reason = e instanceof Error && e.name === 'AbortError' ? 'timeout' : 'network_error'
      this.log.warn(`LLM 调用失败(${reason})`)
      return { ok: false, content: '', reason }
    } finally {
      clearTimeout(timer)
    }
  }
}
