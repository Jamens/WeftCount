import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common'
import type { Observable } from 'rxjs'
import { map } from 'rxjs/operators'
import type { ApiSuccess } from '@weftcount/shared'

/**
 * 统一响应包装
 * 约定：Controller 直接返回业务数据，这里统一包成 { code:0, message:'ok', data, ts }。
 * 若 Controller 已自行包装（返回体含 code 字段），则不再二次包装。
 */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, ApiSuccess<T> | T> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<ApiSuccess<T> | T> {
    return next.handle().pipe(
      map((data) => {
        if (this.isAlreadyWrapped(data)) {
          return data
        }
        return {
          code: 0,
          message: 'ok',
          data,
          ts: Date.now(),
        } satisfies ApiSuccess<T>
      }),
    )
  }

  private isAlreadyWrapped(value: unknown): boolean {
    return (
      typeof value === 'object' &&
      value !== null &&
      'code' in value &&
      'data' in value &&
      'ts' in value
    )
  }
}
