import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { OrderService } from './order.service'
import { CreateOrderDto, OrderFilterDto, UpdateOrderDto } from './order.dto'
import { TradeOrderEntity, type TradeOrderStatus } from './entities/trade-order.entity'
import { AuthGuard } from '../auth/guards/auth.guard'
import { CurrentUser, type RequestContext } from '../auth/auth-context'
import { Permission } from '../auth/permissions'
import { RequirePermission } from '../auth/decorators/require-permission.decorator'
import { Audit } from '../audit/audit.interceptor'

/**
 * 采购 / 销售订单
 *
 * 读权限同时接受 purchase.view 与 sales.view（任一即可），
 * 写权限按订单类型在 service 内再按 purchase.manage / sales.manage 收紧，
 * 这里用「采购或销售管理任一」放行，类型维度的精确控制在 service。
 */
@ApiTags('采购 / 销售订单')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('orders')
export class OrderController {
  constructor(private readonly svc: OrderService) {}

  @Post()
  @RequirePermission(Permission.PURCHASE_MANAGE, Permission.SALES_MANAGE)
  @Audit({ action: 'create', module: 'order' })
  @ApiOperation({ summary: '新建采购/销售订单（草稿）' })
  create(@CurrentUser() ctx: RequestContext, @Body() dto: CreateOrderDto): Promise<TradeOrderEntity> {
    return this.svc.create(ctx.tenantId, ctx.companyId, dto)
  }

  @Get()
  @RequirePermission(Permission.PURCHASE_VIEW, Permission.SALES_VIEW)
  @ApiOperation({ summary: '查询订单列表' })
  findAll(@CurrentUser() ctx: RequestContext, @Query() filter: OrderFilterDto): Promise<TradeOrderEntity[]> {
    return this.svc.findAll(ctx.tenantId, ctx.companyId, filter)
  }

  @Get(':id')
  @RequirePermission(Permission.PURCHASE_VIEW, Permission.SALES_VIEW)
  @ApiOperation({ summary: '查询订单详情（含已关联履约单据与进度）' })
  findOne(@CurrentUser() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.getDetail(ctx.tenantId, ctx.companyId, id)
  }

  @Patch(':id')
  @RequirePermission(Permission.PURCHASE_MANAGE, Permission.SALES_MANAGE)
  @Audit({ action: 'update', module: 'order', targetIdParam: 'id' })
  @ApiOperation({ summary: '更新订单（仅草稿）' })
  update(
    @CurrentUser() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateOrderDto,
  ): Promise<TradeOrderEntity> {
    return this.svc.update(ctx.tenantId, ctx.companyId, id, dto)
  }

  @Post(':id/confirm')
  @RequirePermission(Permission.PURCHASE_MANAGE, Permission.SALES_MANAGE)
  @Audit({ action: 'submit', module: 'order', targetIdParam: 'id' })
  @ApiOperation({ summary: '确认订单（草稿→已确认）' })
  confirm(@CurrentUser() ctx: RequestContext, @Param('id') id: string): Promise<TradeOrderEntity> {
    return this.svc.transition(ctx.tenantId, ctx.companyId, id, 'confirmed')
  }

  @Post(':id/complete')
  @RequirePermission(Permission.PURCHASE_MANAGE, Permission.SALES_MANAGE)
  @Audit({ action: 'update', module: 'order', targetIdParam: 'id' })
  @ApiOperation({ summary: '完成订单（已确认→已完成）' })
  complete(@CurrentUser() ctx: RequestContext, @Param('id') id: string): Promise<TradeOrderEntity> {
    return this.svc.transition(ctx.tenantId, ctx.companyId, id, 'completed')
  }

  @Post(':id/cancel')
  @RequirePermission(Permission.PURCHASE_MANAGE, Permission.SALES_MANAGE)
  @Audit({ action: 'cancel', module: 'order', targetIdParam: 'id' })
  @ApiOperation({ summary: '取消订单' })
  cancel(@CurrentUser() ctx: RequestContext, @Param('id') id: string): Promise<TradeOrderEntity> {
    return this.svc.transition(ctx.tenantId, ctx.companyId, id, 'cancelled' as TradeOrderStatus)
  }
}
