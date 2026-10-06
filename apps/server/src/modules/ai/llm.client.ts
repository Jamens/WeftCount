import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LlmResult {
  ok: boolean
  content: string
  /** 失败原因：no_api_key / timeout / http_error / network_error / bad_json */
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

  get enabled(): boolean {
    return !!this.config.get<string>('AI_API_KEY')
  }

  async chat(messages: LlmMessage[], opts?: { temperature?: number; timeoutMs?: number }): Promise<LlmResult> {
    const apiKey = this.config.get<string>('AI_API_KEY')
    if (!apiKey) return { ok: false, content: '', reason: 'no_api_key' }
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
