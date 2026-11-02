import { Controller, Get } from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'
import { ApiTags } from '@nestjs/swagger'
import type { ApiSuccess } from '@weftcount/shared'

interface HealthPayload {
  status: 'ok'
  service: string
  version: string
  timestamp: string
}

/**
 * 健康检查豁免限速。
 * 探活/负载均衡会高频打这个端点，被限速误伤会导致实例被摘掉。
 */
@SkipThrottle()
@ApiTags('健康检查')
@Controller('health')
export class HealthController {
  @Get()
  check(): ApiSuccess<HealthPayload> {
    return {
      code: 0,
      message: 'ok',
      data: {
        status: 'ok',
        service: 'weftcount-server',
        version: '0.1.0',
        timestamp: new Date().toISOString(),
      },
      ts: Date.now(),
    }
  }
}
