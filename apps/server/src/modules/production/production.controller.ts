import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { ProductionService } from './production.service'
import {
  CreateMachineDto,
  CreateProductionOrderDto,
  CreateReportDto,
  ProductionOrderFilterDto,
  UpdateMachineDto,
  UpdateProductionOrderDto,
} from './production.dto'
import { MachineEntity, type MachineStatus } from './entities/machine.entity'
import { ProductionOrderEntity } from './entities/production-order.entity'
import { AuthGuard } from '../auth/guards/auth.guard'
import { CurrentUser, type RequestContext } from '../auth/auth-context'
import { Permission } from '../auth/permissions'
import { RequirePermission } from '../auth/decorators/require-permission.decorator'
import { Audit } from '../audit/audit.interceptor'

@ApiTags('机台管理')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('machines')
export class MachineController {
  constructor(private readonly svc: ProductionService) {}

  @Post()
  @RequirePermission(Permission.PRODUCTION_ORDER_EDIT)
  @Audit({ action: 'create', module: 'machine', targetType: 'machine' })
  @ApiOperation({ summary: '新建机台' })
  create(@CurrentUser() ctx: RequestContext, @Body() dto: CreateMachineDto): Promise<MachineEntity> {
    return this.svc.createMachine(ctx.tenantId, ctx.companyId, dto)
  }

  @Get()
  @RequirePermission(Permission.PRODUCTION_VIEW)
  @ApiOperation({ summary: '查询机台列表' })
  findAll(@CurrentUser() ctx: RequestContext, @Query('status') status?: MachineStatus): Promise<MachineEntity[]> {
    return this.svc.findMachines(ctx.tenantId, ctx.companyId, status)
  }

  @Patch(':id')
  @RequirePermission(Permission.PRODUCTION_ORDER_EDIT)
  @Audit({ action: 'update', module: 'machine', targetType: 'machine', targetIdParam: 'id' })
  @ApiOperation({ summary: '更新机台' })
  update(@CurrentUser() ctx: RequestContext, @Param('id') id: string, @Body() dto: UpdateMachineDto): Promise<MachineEntity> {
    return this.svc.updateMachine(ctx.tenantId, ctx.companyId, id, dto)
  }
}

@ApiTags('生产工单 / 报工')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('production-orders')
export class ProductionOrderController {
  constructor(private readonly svc: ProductionService) {}

  @Post()
  @RequirePermission(Permission.PRODUCTION_ORDER_EDIT)
  @Audit({ action: 'create', module: 'production', targetType: 'production_order' })
  @ApiOperation({ summary: '新建生产工单' })
  create(@CurrentUser() ctx: RequestContext, @Body() dto: CreateProductionOrderDto): Promise<ProductionOrderEntity> {
    return this.svc.createOrder(ctx.tenantId, ctx.companyId, dto)
  }

  @Get()
  @RequirePermission(Permission.PRODUCTION_VIEW)
  @ApiOperation({ summary: '查询生产工单列表' })
  findAll(@CurrentUser() ctx: RequestContext, @Query() filter: ProductionOrderFilterDto): Promise<ProductionOrderEntity[]> {
    return this.svc.findOrders(ctx.tenantId, ctx.companyId, filter)
  }

  @Get('reportable')
  @RequirePermission(Permission.PRODUCTION_REPORT)
  @ApiOperation({ summary: '可报工工单（挡车工用，含机台名/规格名，只需 production.report 权限）' })
  reportable(@CurrentUser() ctx: RequestContext) {
    return this.svc.listReportable(ctx.tenantId, ctx.companyId)
  }

  @Get(':id')
  @RequirePermission(Permission.PRODUCTION_VIEW)
  @ApiOperation({ summary: '查询工单详情（含报工记录与进度）' })
  findOne(@CurrentUser() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.getOrderDetail(ctx.tenantId, ctx.companyId, id)
  }

  @Patch(':id')
  @RequirePermission(Permission.PRODUCTION_ORDER_EDIT)
  @Audit({ action: 'update', module: 'production', targetType: 'production_order', targetIdParam: 'id' })
  @ApiOperation({ summary: '更新生产工单（仅草稿/已排产）' })
  update(@CurrentUser() ctx: RequestContext, @Param('id') id: string, @Body() dto: UpdateProductionOrderDto): Promise<ProductionOrderEntity> {
    return this.svc.updateOrder(ctx.tenantId, ctx.companyId, id, dto)
  }

  @Post(':id/schedule')
  @RequirePermission(Permission.PRODUCTION_ORDER_EDIT)
  @Audit({ action: 'submit', module: 'production', targetType: 'production_order', targetIdParam: 'id' })
  @ApiOperation({ summary: '排产（草稿→已排产，需已指派机台）' })
  schedule(@CurrentUser() ctx: RequestContext, @Param('id') id: string): Promise<ProductionOrderEntity> {
    return this.svc.transition(ctx.tenantId, ctx.companyId, id, 'scheduled')
  }

  @Post(':id/start')
  @RequirePermission(Permission.PRODUCTION_ORDER_EDIT)
  @Audit({ action: 'submit', module: 'production', targetType: 'production_order', targetIdParam: 'id' })
  @ApiOperation({ summary: '开工（已排产→生产中）' })
  start(@CurrentUser() ctx: RequestContext, @Param('id') id: string): Promise<ProductionOrderEntity> {
    return this.svc.transition(ctx.tenantId, ctx.companyId, id, 'in_progress')
  }

  @Post(':id/complete')
  @RequirePermission(Permission.PRODUCTION_ORDER_EDIT)
  @Audit({ action: 'update', module: 'production', targetType: 'production_order', targetIdParam: 'id' })
  @ApiOperation({ summary: '完成工单' })
  complete(@CurrentUser() ctx: RequestContext, @Param('id') id: string): Promise<ProductionOrderEntity> {
    return this.svc.transition(ctx.tenantId, ctx.companyId, id, 'completed')
  }

  @Post(':id/cancel')
  @RequirePermission(Permission.PRODUCTION_ORDER_EDIT)
  @Audit({ action: 'cancel', module: 'production', targetType: 'production_order', targetIdParam: 'id' })
  @ApiOperation({ summary: '取消工单' })
  cancel(@CurrentUser() ctx: RequestContext, @Param('id') id: string): Promise<ProductionOrderEntity> {
    return this.svc.transition(ctx.tenantId, ctx.companyId, id, 'cancelled')
  }

  @Post(':id/reports')
  @RequirePermission(Permission.PRODUCTION_REPORT)
  @Audit({ action: 'create', module: 'production.report', targetIdParam: 'id' })
  @ApiOperation({ summary: '挡车工报工（累计产出，满额自动完成）' })
  report(@CurrentUser() ctx: RequestContext, @Param('id') id: string, @Body() dto: CreateReportDto) {
    return this.svc.report(ctx.tenantId, ctx.companyId, ctx.userId, id, dto)
  }
}
