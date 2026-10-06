import { Controller, Get, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { CostService } from './cost.service'
import { AuthGuard } from '../auth/guards/auth.guard'
import { CurrentUser, type RequestContext } from '../auth/auth-context'
import { Permission } from '../auth/permissions'
import { RequirePermission } from '../auth/decorators/require-permission.decorator'

@ApiTags('成本报表')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('cost')
export class CostController {
  constructor(private readonly svc: CostService) {}

  @Get('analysis')
  @RequirePermission(Permission.COST_VIEW)
  @ApiOperation({ summary: '按规格的成本构成与毛利分析' })
  analysis(@CurrentUser() ctx: RequestContext) {
    return this.svc.analysis(ctx.tenantId, ctx.companyId)
  }
}
