import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { AuthGuard } from '../auth/guards/auth.guard'
import { CurrentUser, type RequestContext } from '../auth/auth-context'
import { Permission } from '../auth/permissions'
import { RequirePermission } from '../auth/decorators/require-permission.decorator'
import { Audit } from '../audit/audit.interceptor'
import { EnergyService } from './energy.service'
import { CreateReadingDto, ReadingFilterDto, StatsQueryDto, UpdateReadingDto } from './energy.dto'

/**
 * 设备能耗
 *
 * 读 `cost.view`、写 `cost.manage`（与 /cost 同源）：
 * 会计录抄表、核算单耗，厂长可读；仓管/工艺员无 cost 域进不来。
 * 能耗不是工资那种资金凭据，只读访客（`*.view`）能看可以接受。
 */
@ApiTags('设备能耗')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('energy')
export class EnergyController {
  constructor(private readonly service: EnergyService) {}

  // ---------- 抄表（写） ----------

  @Post('readings')
  @Audit({ action: 'create', module: 'energy' })
  @RequirePermission(Permission.COST_MANAGE)
  @ApiOperation({ summary: '录抄表（存累计表底，用量由差值派生；表底回退被拒）' })
  createReading(@CurrentUser() ctx: RequestContext, @Body() dto: CreateReadingDto) {
    return this.service.createReading(ctx, dto)
  }

  @Put('readings/:id')
  @Audit({ action: 'update', module: 'energy', targetIdParam: 'id' })
  @RequirePermission(Permission.COST_MANAGE)
  @ApiOperation({ summary: '改抄表记录（仅电价/备注——读数与日期属序列键，抄错请删后重录）' })
  updateReading(@CurrentUser() ctx: RequestContext, @Param('id') id: string, @Body() dto: UpdateReadingDto) {
    return this.service.updateReading(ctx, id, dto)
  }

  @Delete('readings/:id')
  @Audit({ action: 'delete', module: 'energy', targetIdParam: 'id' })
  @RequirePermission(Permission.COST_MANAGE)
  @ApiOperation({ summary: '删抄表记录（用量是派生量，重算自动生效）' })
  deleteReading(@CurrentUser() ctx: RequestContext, @Param('id') id: string) {
    return this.service.deleteReading(ctx, id)
  }

  // ---------- 抄表（读） ----------

  @Get('machines')
  @RequirePermission(Permission.COST_VIEW)
  @ApiOperation({ summary: '机台选项（录抄表用；会计无 production.view，故本模块自带参照数据）' })
  listMachines(@CurrentUser() ctx: RequestContext) {
    return this.service.listMachineOptions(ctx)
  }

  @Get('readings')
  @RequirePermission(Permission.COST_VIEW)
  @ApiOperation({ summary: '抄表记录列表（含派生用量与电费，首条标基线）' })
  listReadings(@CurrentUser() ctx: RequestContext, @Query() q: ReadingFilterDto) {
    return this.service.listReadings(ctx, q)
  }

  // ---------- 分析 ----------

  @Get('stats')
  @RequirePermission(Permission.COST_VIEW)
  @ApiOperation({ summary: '期间单位产量电耗（kWh/百米，按机台 + 合计）' })
  stats(@CurrentUser() ctx: RequestContext, @Query() q: StatsQueryDto) {
    return this.service.getStats(ctx, q.periodStart, q.periodEnd)
  }

  @Get('compare')
  @RequirePermission(Permission.COST_VIEW)
  @ApiOperation({ summary: '单耗环比（与上一个等长期间比）' })
  compare(@CurrentUser() ctx: RequestContext, @Query() q: StatsQueryDto) {
    return this.service.getCompare(ctx, q.periodStart, q.periodEnd)
  }
}