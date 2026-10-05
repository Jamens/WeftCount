import { Controller, Get } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { ApiSuccess } from '@weftcount/shared'

interface HealthPayload {
  status: 'ok'
  service: string
  version: string
  timestamp: string
}

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
