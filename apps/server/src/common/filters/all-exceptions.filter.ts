import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common'
import type { Request, Response } from 'express'
import { ErrorCode, type ApiFailure } from '@weftcount/shared'

interface BodyWithMessage {
  message?: string | string[]
  error?: string
}

/**
 * 全局异常过滤器
 * 职责：把任何异常统一成 ApiFailure envelope，绝不把堆栈泄露给前端。
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name)

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp()
    const res = ctx.getResponse<Response>()
    const req = ctx.getRequest<Request>()

    const traceId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const { status, code, message, errors } = this.normalize(exception)

    if (status >= 500) {
      this.logger.error(
        `[${traceId}] ${req.method} ${req.url} -> ${status}: ${message}`,
        exception instanceof Error ? exception.stack : undefined,
      )
    } else {
      this.logger.warn(`[${traceId}] ${req.method} ${req.url} -> ${status}: ${message}`)
    }

    const body: ApiFailure = {
      code,
      message,
      data: null,
      ts: Date.now(),
      traceId,
    }
    if (errors) body.errors = errors

    res.status(status).json(body)
  }

  private normalize(exception: unknown): {
    status: number
    code: number
    message: string
    errors?: Record<string, string[]>
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus()
      const resp = exception.getResponse()
      const body: BodyWithMessage =
        typeof resp === 'string' ? { message: resp } : (resp as BodyWithMessage)
      const rawMsg = body.message
      const message = Array.isArray(rawMsg) ? rawMsg.join('；') : (rawMsg ?? exception.message)

      // class-validator 的字段错误
      let errors: Record<string, string[]> | undefined
      if (body.error === 'Bad Request' && Array.isArray(rawMsg)) {
        errors = { _general: rawMsg }
      }

      return {
        status,
        code: this.mapHttpStatusToCode(status),
        message,
        errors,
      }
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCode.UNKNOWN,
      message: '服务器内部错误，请稍后重试或联系管理员',
    }
  }

  private mapHttpStatusToCode(status: number): number {
    switch (status) {
      case HttpStatus.UNAUTHORIZED:
        return ErrorCode.LOGIN_FAILED
      case HttpStatus.FORBIDDEN:
        return ErrorCode.FORBIDDEN
      case HttpStatus.NOT_FOUND:
        return ErrorCode.NOT_FOUND
      case HttpStatus.BAD_REQUEST:
        return ErrorCode.VALIDATION_FAILED
      case HttpStatus.CONFLICT:
        return ErrorCode.CONFLICT
      default:
        return ErrorCode.UNKNOWN
    }
  }
}
