import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { AnalyticsService } from './analytics.service'
import { AuthGuard } from '../auth/guards/auth.guard'
import { CurrentUser, type RequestContext } from '../auth/auth-context'
import { Permission } from '../auth/permissions'
import { RequirePermission } from '../auth/decorators/require-permission.decorator'

@ApiTags('趋势分析')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly svc: AnalyticsService) {}

  @Get('trends')
  @RequirePermission(Permission.COST_VIEW)
  @ApiOperation({ summary: '趋势聚合：日产量/日采购/日销售/规格占比（确定性，无预测）' })
  trends(@CurrentUser() ctx: RequestContext, @Query('days') days?: string) {
    return this.svc.trends(ctx.companyId, Number(days) || 30)
  }
}
