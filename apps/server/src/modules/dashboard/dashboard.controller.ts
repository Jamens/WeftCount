import { Controller, Get, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { DashboardService } from './dashboard.service'
import { AuthGuard } from '../auth/guards/auth.guard'
import { CurrentUser, type RequestContext } from '../auth/auth-context'
import { Permission } from '../auth/permissions'
import { RequirePermission } from '../auth/decorators/require-permission.decorator'

@ApiTags('首页概览')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly svc: DashboardService) {}

  /**
   * 权限说明：概览是**跨业务域的汇总**，故用「任一业务查看权限即可进入」。
   *
   * 为什么不能只挂单一权限：首页要在**每个角色**下都能打开，否则会计（无
   * production.view）、挡车工（只有 production.report）一登录就撞 403，
   * 首页形同虚设。
   * 为什么不用「登录即可」：匿名/停用账号不该拿到全厂经营概览。
   * 金额类字段（采购/销售/货值）由**前端按 cost.view/report.view 再过滤**，
   * 只读访客（`*.view`）能进首页但看不到金额——这是展示层收敛，不是安全边界，
   * 因为它们本就来自同一个端点。
   *
   * 换言之：**进入门槛低、敏感数字收敛**，与「只读访客仅查看看板」的定位一致。
   */
  @Get('overview')
  @RequirePermission(
    Permission.PRODUCTION_VIEW,
    // 挡车工只有 production.report，没有 production.view，但首页产量卡片正是给他看的
    Permission.PRODUCTION_REPORT,
    Permission.INVENTORY_VIEW,
    Permission.COST_VIEW,
    Permission.REPORT_VIEW,
    Permission.PURCHASE_VIEW,
    Permission.SALES_VIEW,
  )
  @ApiOperation({ summary: '首页概览：库存/采购/销售/生产/待办 + 近7日日产量（确定性聚合，无预测）' })
  overview(@CurrentUser() ctx: RequestContext) {
    return this.svc.overview(ctx.companyId)
  }
}