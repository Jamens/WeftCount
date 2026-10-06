import { Controller, Get, Param, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { TraceabilityService } from './traceability.service'
import { AuthGuard } from '../auth/guards/auth.guard'
import { CurrentUser, type RequestContext } from '../auth/auth-context'
import { Permission } from '../auth/permissions'
import { RequirePermission } from '../auth/decorators/require-permission.decorator'

@ApiTags('全链路追溯')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('traceability')
export class TraceabilityController {
  constructor(private readonly svc: TraceabilityService) {}

  @Get('sales/:docId')
  @RequirePermission(Permission.REPORT_VIEW)
  @ApiOperation({ summary: '销售单倒查：这匹布经了哪台织机/哪张工单/哪个供应商' })
  traceSales(@CurrentUser() ctx: RequestContext, @Param('docId') docId: string) {
    return this.svc.traceSalesDoc(ctx.tenantId, ctx.companyId, docId)
  }

  @Get('batch/:batchId')
  @RequirePermission(Permission.REPORT_VIEW)
  @ApiOperation({ summary: '批次双向追溯：从哪来 + 到哪去' })
  traceBatch(@CurrentUser() ctx: RequestContext, @Param('batchId') batchId: string) {
    return this.svc.traceBatch(ctx.tenantId, ctx.companyId, batchId)
  }
}
