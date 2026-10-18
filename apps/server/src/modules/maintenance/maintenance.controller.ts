import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { AuthGuard } from '../auth/guards/auth.guard'
import { CurrentUser, type RequestContext } from '../auth/auth-context'
import { Permission } from '../auth/permissions'
import { RequirePermission } from '../auth/decorators/require-permission.decorator'
import { Audit } from '../audit/audit.interceptor'
import { MaintenanceService } from './maintenance.service'
import {
  CreatePlanDto,
  CreateRecordDto,
  CreateSparePartDto,
  PlanFilterDto,
  RecordFilterDto,
  SparePartFilterDto,
  UpdatePlanDto,
  UpdateSparePartDto,
} from './maintenance.dto'

/**
 * 设备维保
 *
 * 机台是生产资源，保养是生产动作，所以：
 * - 读接口复用 `production.view`（厂长/工艺员/仓管都持；会计、挡车工、访客按各自角色判定）
 * - 写接口（计划/执行/备件）复用 `production.order.edit`
 * 不新增权限码，避免触发角色权限重播，也与 `/production` 同源。
 */
@ApiTags('设备维保')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('machine-maintenance')
export class MaintenanceController {
  constructor(private readonly service: MaintenanceService) {}

  // ---------- 保养计划 ----------

  @Post('plans')
  @Audit({ action: 'create', module: 'machine' })
  @RequirePermission(Permission.PRODUCTION_ORDER_EDIT)
  @ApiOperation({ summary: '新建保养计划（自动推算下次到期日）' })
  createPlan(@CurrentUser() ctx: RequestContext, @Body() dto: CreatePlanDto) {
    return this.service.createPlan(ctx, dto)
  }

  @Put('plans/:id')
  @Audit({ action: 'update', module: 'machine', targetIdParam: 'id' })
  @RequirePermission(Permission.PRODUCTION_ORDER_EDIT)
  @ApiOperation({ summary: '修改保养计划' })
  updatePlan(@CurrentUser() ctx: RequestContext, @Param('id') id: string, @Body() dto: UpdatePlanDto) {
    return this.service.updatePlan(ctx, id, dto)
  }

  @Get('plans')
  @RequirePermission(Permission.PRODUCTION_VIEW)
  @ApiOperation({ summary: '保养计划列表（dueSoon 看即将到期）' })
  listPlans(@CurrentUser() ctx: RequestContext, @Query() q: PlanFilterDto) {
    return this.service.listPlans(ctx, q)
  }

  @Get('plans/:id')
  @RequirePermission(Permission.PRODUCTION_VIEW)
  @ApiOperation({ summary: '保养计划详情' })
  getPlan(@CurrentUser() ctx: RequestContext, @Param('id') id: string) {
    return this.service.getPlan(ctx, id)
  }

  // ---------- 维保执行 / 故障停机 ----------

  @Post('records')
  @Audit({ action: 'create', module: 'machine' })
  @RequirePermission(Permission.PRODUCTION_ORDER_EDIT)
  @ApiOperation({ summary: '录维保执行 / 故障停机（事务扣备件+回写计划与机台）' })
  createRecord(@CurrentUser() ctx: RequestContext, @Body() dto: CreateRecordDto) {
    return this.service.createRecord(ctx, dto)
  }

  @Get('records')
  @RequirePermission(Permission.PRODUCTION_VIEW)
  @ApiOperation({ summary: '维保记录列表' })
  listRecords(@CurrentUser() ctx: RequestContext, @Query() q: RecordFilterDto) {
    return this.service.listRecords(ctx, q)
  }

  @Get('records/:id')
  @RequirePermission(Permission.PRODUCTION_VIEW)
  @ApiOperation({ summary: '维保记录详情（含耗用备件）' })
  getRecord(@CurrentUser() ctx: RequestContext, @Param('id') id: string) {
    return this.service.getRecord(ctx, id)
  }

  // ---------- 备件 ----------

  @Post('spare-parts')
  @Audit({ action: 'create', module: 'machine' })
  @RequirePermission(Permission.PRODUCTION_ORDER_EDIT)
  @ApiOperation({ summary: '新建备件' })
  createSparePart(@CurrentUser() ctx: RequestContext, @Body() dto: CreateSparePartDto) {
    return this.service.createSparePart(ctx, dto)
  }

  @Put('spare-parts/:id')
  @Audit({ action: 'update', module: 'machine', targetIdParam: 'id' })
  @RequirePermission(Permission.PRODUCTION_ORDER_EDIT)
  @ApiOperation({ summary: '修改备件（含调整库存/安全库存）' })
  updateSparePart(@CurrentUser() ctx: RequestContext, @Param('id') id: string, @Body() dto: UpdateSparePartDto) {
    return this.service.updateSparePart(ctx, id, dto)
  }

  @Get('spare-parts')
  @RequirePermission(Permission.PRODUCTION_VIEW)
  @ApiOperation({ summary: '备件列表（lowStock 看低于安全库存）' })
  listSpareParts(@CurrentUser() ctx: RequestContext, @Query() q: SparePartFilterDto) {
    return this.service.listSpareParts(ctx, q)
  }

  @Get('spare-parts/:id')
  @RequirePermission(Permission.PRODUCTION_VIEW)
  @ApiOperation({ summary: '备件详情' })
  getSparePart(@CurrentUser() ctx: RequestContext, @Param('id') id: string) {
    return this.service.getSparePart(ctx, id)
  }

  // ---------- 看板 ----------

  @Get('overview')
  @RequirePermission(Permission.PRODUCTION_VIEW)
  @ApiOperation({ summary: '维保总览（设备数/计划/到期/逾期/本月故障/备件预警）' })
  overview(@CurrentUser() ctx: RequestContext) {
    return this.service.getOverview(ctx)
  }

  @Get('mtbf')
  @RequirePermission(Permission.PRODUCTION_VIEW)
  @ApiOperation({ summary: '故障统计 MTBF（按机台：故障次数/总停机/平均间隔）' })
  mtbf(@CurrentUser() ctx: RequestContext) {
    return this.service.getMtbf(ctx)
  }
}
