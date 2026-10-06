import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator'
import { AuthGuard } from '../auth/guards/auth.guard'
import { CurrentUser, type RequestContext } from '../auth/auth-context'
import { Permission } from '../auth/permissions'
import { RequirePermission } from '../auth/decorators/require-permission.decorator'
import { Audit } from '../audit/audit.interceptor'
import { InventoryService, type CreateDocInput } from './inventory.service'
import type { InventoryDocType } from './entities/inventory-document.entity'

class CreateDocDto implements CreateDocInput {
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
  @MaxLength(128)
  counterparty?: string | null

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

  @Get('batches')
  @RequirePermission(Permission.INVENTORY_VIEW)
  @ApiOperation({ summary: '批次列表' })
  batches(@CurrentUser() ctx: RequestContext, @Query('specId') specId?: string, @Query('status') status?: string) {
    return this.inventory.listBatches(ctx.tenantId, ctx.companyId, { specId, status })
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
}
