import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { AlertService } from './alert.service'
import { AuthGuard } from '../auth/guards/auth.guard'
import { CurrentUser, type RequestContext } from '../auth/auth-context'
import { Permission } from '../auth/permissions'
import { RequirePermission } from '../auth/decorators/require-permission.decorator'
import { Audit } from '../audit/audit.interceptor'

@ApiTags('预警中心')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('alerts')
export class AlertController {
  constructor(private readonly svc: AlertService) {}

  @Get()
  @RequirePermission(Permission.INVENTORY_VIEW)
  @ApiOperation({ summary: '预警列表（默认未确认）' })
  list(@CurrentUser() ctx: RequestContext, @Query('all') all?: string) {
    return this.svc.list(ctx.companyId, all !== 'true')
  }

  @Get('summary')
  @RequirePermission(Permission.INVENTORY_VIEW)
  @ApiOperation({ summary: '未确认预警数（角标）' })
  async summary(@CurrentUser() ctx: RequestContext) {
    return { open: await this.svc.openCount(ctx.companyId) }
  }

  @Post('scan')
  @RequirePermission(Permission.INVENTORY_MANAGE)
  @Audit({ action: 'update', module: 'alert' })
  @ApiOperation({ summary: '扫描生成预警（交期逾期/库存低位/呆滞批次）' })
  scan(@CurrentUser() ctx: RequestContext) {
    return this.svc.scan(ctx.tenantId, ctx.companyId)
  }

  @Post(':id/ack')
  @RequirePermission(Permission.INVENTORY_MANAGE)
  @Audit({ action: 'update', module: 'alert', targetIdParam: 'id' })
  @ApiOperation({ summary: '确认(忽略)一条预警' })
  async ack(@CurrentUser() ctx: RequestContext, @Param('id') id: string) {
    const a = await this.svc.acknowledge(ctx.companyId, id, ctx.userId)
    return { ok: !!a }
  }
}
