import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsArray, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator'
import { AuthGuard } from '../auth/guards/auth.guard'
import { CurrentUser, type RequestContext } from '../auth/auth-context'
import { Permission } from '../auth/permissions'
import { RequirePermission } from '../auth/decorators/require-permission.decorator'
import { Audit } from '../audit/audit.interceptor'
import { InventoryService, type CreateDocInput } from './inventory.service'
import type { InventoryDocType } from './entities/inventory-document.entity'

class PickItemDto {
  @IsString()
  batchId!: string

  /** 拣货数量（米，主单位） */
  @IsNumber({}, { message: '拣货数量必须为数字' })
  @Min(0.001, { message: '拣货数量必须大于 0' })
  quantityM!: number
}

class RollDto {
  @IsString()
  @IsNotEmpty({ message: '件卡号不能为空' })
  rollNo!: string

  /** 该匹米数 */
  @IsNumber({}, { message: '件卡米数必须为数字' })
  @Min(0.001, { message: '件卡米数必须大于 0' })
  meters!: number
}

class PickRollDto {
  @IsString()
  @IsNotEmpty({ message: '件卡号不能为空' })
  rollNo!: string

  /**
   * 本次发货米数（**可选**）
   * - 不传 → 整匹发（发该匹全部剩余量）
   * - 传了 → 拆匹发该米数，残匹留在库（remaining_m 递减，为 0 才置已售）
   * 上限由服务端校验（不得超过该匹剩余量）。
   */
  @IsOptional()
  @IsNumber({}, { message: '发货米数必须为数字' })
  @Min(0.001, { message: '发货米数必须大于 0' })
  meters?: number
}

class CreateDocDto implements CreateDocInput {
  /**
   * 客户端幂等键（可选）：桌面端离线队列重放时复用同一个值，
   * 服务端据此去重，避免同一笔单据被重复过账。
   */
  @IsOptional() @IsString() @MaxLength(64)
  clientRequestId?: string | null

  @IsString()
  materialId!: string

  @IsString()
  specId!: string

  /** 录入单位：采购填 kg 类（kg/g/t），领用填 m 类（m/yd/...），销售填 m2 类（m2/ft2/...） */
  @IsString()
  @MaxLength(8)
  enteredUnit!: string

  @IsNumber({}, { message: '录入数量必须为数字' })
  @Min(0.0001, { message: '录入数量必须大于 0' })
  enteredValue!: number

  @IsOptional()
  @IsNumber()
  unitPrice?: number | null

  @IsOptional()
  @IsString()
  partnerId?: string | null

  /** 关联订单（采购/销售可挂已确认订单；领用不传） */
  @IsOptional()
  @IsString()
  orderId?: string | null

  /** 履约的订单明细行 id（多明细订单按行算进度；不传按规格自动归到首个未满行） */
  @IsOptional()
  @IsString()
  orderItemId?: string | null

  /** 入库仓库（不传则落第一个启用仓） */
  @IsOptional()
  @IsString()
  warehouseId?: string | null

  /** 扫码拣货（仅出库）：指定发货批次与数量(米)，传了则按这些批次消耗而非 FIFO */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PickItemDto)
  pickedItems?: PickItemDto[] | null

  /** 件卡逐匹发货（仅出库）：扫件卡发整匹，件卡状态置已出库 */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PickRollDto)
  pickedRolls?: PickRollDto[] | null

  /** 逐匹入库（仅采购入库）：扫件卡逐匹登记(rollNo+米数)，防重扫 */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RollDto)
  rolls?: RollDto[] | null

  @IsOptional()
  @IsString()
  @MaxLength(255)
  remark?: string | null
}

class TransferDto {
  @IsString()
  sourceBatchId!: string

  @IsString()
  toWarehouseId!: string

  /** 调拨数量（米，主单位） */
  @IsNumber({}, { message: '调拨数量必须为数字' })
  @Min(0.0001, { message: '调拨数量必须大于 0' })
  quantityM!: number

  @IsOptional()
  @IsString()
  @MaxLength(255)
  remark?: string | null
}

@Controller('inventory')
@UseGuards(AuthGuard)
@ApiBearerAuth()
@ApiTags('库存 / 一件事三算')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Post('purchase-inbound')
  @RequirePermission(Permission.INVENTORY_MANAGE)
  @Audit({ action: 'create', module: 'inventory.purchase' })
  @ApiOperation({ summary: '采购入库（按重量录入，kg/t/g）' })
  purchaseInbound(@CurrentUser() ctx: RequestContext, @Body() dto: CreateDocDto) {
    return this.inventory.createPurchaseInbound(ctx, dto)
  }

  @Post('production-issue')
  @RequirePermission(Permission.INVENTORY_MANAGE)
  @Audit({ action: 'create', module: 'inventory.issue' })
  @ApiOperation({ summary: '生产领用（按长度录入，m/yd/...）' })
  productionIssue(@CurrentUser() ctx: RequestContext, @Body() dto: CreateDocDto) {
    return this.inventory.createProductionIssue(ctx, dto)
  }

  @Post('sales-outbound')
  @RequirePermission(Permission.INVENTORY_MANAGE)
  @Audit({ action: 'create', module: 'inventory.sales' })
  @ApiOperation({ summary: '销售出库（按面积录入，m2/ft2/...）' })
  salesOutbound(@CurrentUser() ctx: RequestContext, @Body() dto: CreateDocDto) {
    return this.inventory.createSalesOutbound(ctx, dto)
  }

  /** 列批次的件卡（件卡标签打印用） */
  @Get('rolls')
  @RequirePermission(Permission.INVENTORY_VIEW)
  @ApiOperation({ summary: '列件卡(可按批次/状态过滤)，件卡标签打印用' })
  listRolls(@CurrentUser() ctx: RequestContext, @Query('batchId') batchId?: string, @Query('status') status?: string) {
    return this.inventory.listRolls(ctx.tenantId, ctx.companyId, { batchId, status })
  }

  /** 件卡轻量查询（扫码发货用） */
  @Get('rolls/lookup')
  @RequirePermission(Permission.INVENTORY_MANAGE)
  @ApiOperation({ summary: '按件卡号查米数/规格/批次/状态(发货扫码用)' })
  lookupRoll(@CurrentUser() ctx: RequestContext, @Query('rollNo') rollNo: string) {
    return this.inventory.lookupRoll(ctx.tenantId, ctx.companyId, rollNo)
  }

  /** 件卡全链路追溯：件卡→批次→入库单(供应商/采购订单)→出库单(客户/销售订单) */
  @Get('rolls/trace')
  @RequirePermission(Permission.REPORT_VIEW)
  @ApiOperation({ summary: '按件卡号追溯全链路(来源批次/供应商/采购订单/售出去向)' })
  traceRoll(@CurrentUser() ctx: RequestContext, @Query('rollNo') rollNo: string) {
    return this.inventory.traceRoll(ctx.tenantId, ctx.companyId, rollNo)
  }

  @Get('batches')
  @RequirePermission(Permission.INVENTORY_VIEW)
  @ApiOperation({ summary: '批次列表' })
  batches(
    @CurrentUser() ctx: RequestContext,
    @Query('specId') specId?: string,
    @Query('status') status?: string,
    @Query('warehouseId') warehouseId?: string,
  ) {
    return this.inventory.listBatches(ctx.tenantId, ctx.companyId, { specId, status, warehouseId })
  }

  @Get('documents')
  @RequirePermission(Permission.INVENTORY_VIEW)
  @ApiOperation({ summary: '单据列表（采购/领用/销售）' })
  documents(
    @CurrentUser() ctx: RequestContext,
    @Query('docType') docType?: InventoryDocType,
    @Query('specId') specId?: string,
  ) {
    return this.inventory.listDocuments(ctx.tenantId, ctx.companyId, { docType, specId })
  }

  @Get('transactions')
  @RequirePermission(Permission.INVENTORY_VIEW)
  @ApiOperation({ summary: '事务流水' })
  transactions(@CurrentUser() ctx: RequestContext, @Query('batchId') batchId?: string, @Query('docId') docId?: string) {
    return this.inventory.listTransactions(ctx.tenantId, ctx.companyId, { batchId, docId })
  }

  @Get('reconcile')
  @RequirePermission(Permission.INVENTORY_VIEW)
  @ApiOperation({ summary: '一件事三算对账：采购重量 / 生产长度 / 销售面积 折算到重量基准' })
  reconcile(
    @CurrentUser() ctx: RequestContext,
    @Query('specId') specId?: string,
    @Query('toleranceRate') toleranceRate?: string,
  ) {
    return this.inventory.reconcile(ctx.tenantId, ctx.companyId, {
      specId,
      toleranceRate: toleranceRate ? Number(toleranceRate) : undefined,
    })
  }

  @Get('documents/:id')
  @RequirePermission(Permission.INVENTORY_VIEW)
  @ApiOperation({ summary: '单据详情（含折算三视图）' })
  async docDetail(@CurrentUser() ctx: RequestContext, @Param('id') id: string) {
    const list = await this.inventory.listDocuments(ctx.tenantId, ctx.companyId)
    const doc = list.find((d) => d.id === id)
    if (!doc) {
      return null
    }
    const txns = await this.inventory.listTransactions(ctx.tenantId, ctx.companyId, { docId: id })
    return { doc, transactions: txns }
  }

  @Post('transfer')
  @UseGuards(AuthGuard)
  @RequirePermission(Permission.INVENTORY_MANAGE)
  @Audit({ action: 'update', module: 'inventory.transfer' })
  @ApiOperation({ summary: '仓间调拨：把源批次一部分数量移到目标仓（总量守恒）' })
  transfer(@CurrentUser() ctx: RequestContext, @Body() dto: TransferDto) {
    return this.inventory.transfer(ctx, {
      sourceBatchId: dto.sourceBatchId,
      toWarehouseId: dto.toWarehouseId,
      quantityM: dto.quantityM,
      remark: dto.remark ?? null,
    })
  }
}
