import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { IsDateString, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'
import { AuditService, type AuditQueryResult } from './audit.service'
import { AuthGuard } from '../auth/guards/auth.guard'
import { CurrentUser, type RequestContext } from '../auth/auth-context'
import { Permission } from '../auth/permissions'
import { RequirePermission } from '../auth/decorators/require-permission.decorator'
import type { AuditActionType } from '@weftcount/shared'
import type { AuditLogEntity } from './entities/audit-log.entity'

class AuditQueryDto {
  @IsOptional() @IsInt() @Min(1)
  page?: number

  @IsOptional() @IsInt() @Min(1) @Max(200)
  pageSize?: number

  @IsOptional() @IsString()
  userId?: string

  /** 模块前缀，如 purchase */
  @IsOptional() @IsString() @MaxLength(64)
  module?: string

  @IsOptional()
  @IsIn(['create', 'update', 'delete', 'submit', 'approve', 'reject', 'cancel', 'login', 'logout', 'export', 'print', 'ai_call'])
  action?: AuditActionType

  @IsOptional() @IsString() @MaxLength(64)
  targetType?: string

  @IsOptional() @IsString() @MaxLength(64)
  targetId?: string

  @IsOptional() @IsString() @MaxLength(64)
  keyword?: string

  @IsOptional() @IsDateString()
  from?: string

  @IsOptional() @IsDateString()
  to?: string
}

@ApiTags('审计日志')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@RequirePermission(Permission.AUDIT_VIEW)
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @ApiOperation({ summary: '分页查询审计日志' })
  async list(
    @CurrentUser() ctx: RequestContext,
    @Query() q: AuditQueryDto,
  ): Promise<AuditQueryResult> {
    return this.audit.query({
      tenantId: ctx.tenantId,
      companyId: ctx.companyId,
      page: q.page,
      pageSize: q.pageSize,
      userId: q.userId,
      module: q.module,
      action: q.action,
      targetType: q.targetType,
      targetId: q.targetId,
      keyword: q.keyword,
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
    })
  }

  @Get('target')
  @ApiOperation({ summary: '查询某个对象的完整变更史' })
  async byTarget(
    @CurrentUser() ctx: RequestContext,
    @Query('targetType') targetType: string,
    @Query('targetId') targetId: string,
  ): Promise<{ records: AuditLogEntity[] }> {
    const records = await this.audit.queryByTarget(ctx.tenantId, targetType, targetId)
    return { records }
  }
}
