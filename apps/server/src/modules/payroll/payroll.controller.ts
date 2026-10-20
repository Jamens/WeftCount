import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { AuthGuard } from '../auth/guards/auth.guard'
import { CurrentUser, type RequestContext } from '../auth/auth-context'
import { Permission } from '../auth/permissions'
import { RequirePermission } from '../auth/decorators/require-permission.decorator'
import { Audit } from '../audit/audit.interceptor'
import { PayrollService } from './payroll.service'
import {
  CreateProfileDto,
  GenerateSlipsDto,
  ProfileFilterDto,
  SlipFilterDto,
  UpdateProfileDto,
  UpdateSlipDto,
} from './payroll.dto'

/**
 * 计件工资
 *
 * 权限全部 `cost.manage`（会计核算、厂长发放，均持 cost.*）：
 * - 读也走 cost.manage 而不是 .view 结尾的码——工资是资金凭据，
 *   访客的 `*.view` 通配不能命中它（与应收读口 `report.sales` 同一匹配机制）
 * - 挡车工持 production.report / production.self.view，看不到自己工资单
 */
@ApiTags('计件工资')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('wages')
export class PayrollController {
  constructor(private readonly service: PayrollService) {}

  // ---------- 工资档案 ----------

  @Post('profiles')
  @Audit({ action: 'create', module: 'payroll' })
  @RequirePermission(Permission.COST_MANAGE)
  @ApiOperation({ summary: '建工资档案（按登录账号，姓名快照）' })
  createProfile(@CurrentUser() ctx: RequestContext, @Body() dto: CreateProfileDto) {
    return this.service.createProfile(ctx, dto)
  }

  @Put('profiles/:id')
  @Audit({ action: 'update', module: 'payroll', targetIdParam: 'id' })
  @RequirePermission(Permission.COST_MANAGE)
  @ApiOperation({ summary: '改工资档案（调价不影响已生成工资单）' })
  updateProfile(@CurrentUser() ctx: RequestContext, @Param('id') id: string, @Body() dto: UpdateProfileDto) {
    return this.service.updateProfile(ctx, id, dto)
  }

  @Get('profiles')
  @RequirePermission(Permission.COST_MANAGE)
  @ApiOperation({ summary: '工资档案列表' })
  listProfiles(@CurrentUser() ctx: RequestContext, @Query() q: ProfileFilterDto) {
    return this.service.listProfiles(ctx, q)
  }

  // ---------- 工资单 ----------

  @Get('payroll/preview')
  @RequirePermission(Permission.COST_MANAGE)
  @ApiOperation({ summary: '周期报工聚合预览（生成前核对每人米数与预估金额）' })
  preview(@CurrentUser() ctx: RequestContext, @Query('periodStart') periodStart: string, @Query('periodEnd') periodEnd: string) {
    return this.service.previewPeriod(ctx, periodStart, periodEnd)
  }

  @Post('slips')
  @Audit({ action: 'create', module: 'payroll' })
  @RequirePermission(Permission.COST_MANAGE)
  @ApiOperation({ summary: '按周期批量生成工资单（无档案跳过、重复周期幂等）' })
  generateSlips(@CurrentUser() ctx: RequestContext, @Body() dto: GenerateSlipsDto) {
    return this.service.generateSlips(ctx, dto)
  }

  @Put('slips/:id')
  @Audit({ action: 'update', module: 'payroll', targetIdParam: 'id' })
  @RequirePermission(Permission.COST_MANAGE)
  @ApiOperation({ summary: '改奖金/扣款/备注（仅草稿）' })
  updateSlip(@CurrentUser() ctx: RequestContext, @Param('id') id: string, @Body() dto: UpdateSlipDto) {
    return this.service.updateSlip(ctx, id, dto)
  }

  @Post('slips/:id/confirm')
  @Audit({ action: 'submit', module: 'payroll', targetIdParam: 'id' })
  @RequirePermission(Permission.COST_MANAGE)
  @ApiOperation({ summary: '核算确认（草稿→已确认，锁定金额）' })
  confirmSlip(@CurrentUser() ctx: RequestContext, @Param('id') id: string) {
    return this.service.confirmSlip(ctx, id)
  }

  @Post('slips/:id/pay')
  @Audit({ action: 'update', module: 'payroll', targetIdParam: 'id' })
  @RequirePermission(Permission.COST_MANAGE)
  @ApiOperation({ summary: '发放（已确认→已发放，记发放时间）' })
  paySlip(@CurrentUser() ctx: RequestContext, @Param('id') id: string) {
    return this.service.paySlip(ctx, id)
  }

  @Delete('slips/:id')
  @Audit({ action: 'delete', module: 'payroll', targetIdParam: 'id' })
  @RequirePermission(Permission.COST_MANAGE)
  @ApiOperation({ summary: '删除草稿工资单（确认/发放后不可删）' })
  deleteSlip(@CurrentUser() ctx: RequestContext, @Param('id') id: string) {
    return this.service.deleteSlip(ctx, id)
  }

  @Get('slips')
  @RequirePermission(Permission.COST_MANAGE)
  @ApiOperation({ summary: '工资单列表' })
  listSlips(@CurrentUser() ctx: RequestContext, @Query() q: SlipFilterDto) {
    return this.service.listSlips(ctx, q)
  }

  @Get('slips/:id')
  @RequirePermission(Permission.COST_MANAGE)
  @ApiOperation({ summary: '工资单详情（含按工单聚合的计件明细）' })
  getSlip(@CurrentUser() ctx: RequestContext, @Param('id') id: string) {
    return this.service.getSlip(ctx, id)
  }

  // ---------- 总览 ----------

  @Get('overview')
  @RequirePermission(Permission.COST_MANAGE)
  @ApiOperation({ summary: '工资总览（档案数/草稿数/待发金额/已发金额）' })
  overview(@CurrentUser() ctx: RequestContext) {
    return this.service.getOverview(ctx)
  }
}
