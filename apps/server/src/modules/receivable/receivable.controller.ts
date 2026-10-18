import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { AuthGuard } from '../auth/guards/auth.guard'
import { CurrentUser, type RequestContext } from '../auth/auth-context'
import { Permission } from '../auth/permissions'
import { RequirePermission } from '../auth/decorators/require-permission.decorator'
import { Audit } from '../audit/audit.interceptor'
import { ReceivableService } from './receivable.service'
import {
  CreateReceiptDto,
  LedgerQueryDto,
  AgingQueryDto,
  ReceiptFilterDto,
  StatementQueryDto,
} from './receivable.dto'

/**
 * 应收账款 / 客户对账
 *
 * 读接口要求 `report.sales`（业务员已授予；会计/厂长持 `report.*`；租户管理员 `*`）。
 * 写接口（录收款、作废）要求 `sales.manage`——核销是资金动作，不能与只读角色混。
 */
@ApiTags('应收账款')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('receivables')
export class ReceivableController {
  constructor(private readonly service: ReceivableService) {}

  @Post('receipts')
  @Audit({ action: 'create', module: 'receivable' })
  @RequirePermission(Permission.SALES_MANAGE)
  @ApiOperation({ summary: '录收款并核销（冲抵多张未结清销售出库单）' })
  createReceipt(@CurrentUser() ctx: RequestContext, @Body() dto: CreateReceiptDto) {
    return this.service.createReceipt(ctx, dto)
  }

  @Post('receipts/:id/void')
  @Audit({ action: 'delete', module: 'receivable', targetIdParam: 'id' })
  @RequirePermission(Permission.SALES_MANAGE)
  @ApiOperation({ summary: '作废收款单（回退对应出库单的已核销额）' })
  voidReceipt(@CurrentUser() ctx: RequestContext, @Param('id') id: string) {
    return this.service.voidReceipt(ctx, id)
  }

  @Get('receipts')
  @RequirePermission(Permission.REPORT_SALES)
  @ApiOperation({ summary: '收款单列表' })
  listReceipts(@CurrentUser() ctx: RequestContext, @Query() q: ReceiptFilterDto) {
    return this.service.listReceipts(ctx, q)
  }

  @Get('receipts/:id')
  @RequirePermission(Permission.REPORT_SALES)
  @ApiOperation({ summary: '收款单详情（含核销明细）' })
  getReceipt(@CurrentUser() ctx: RequestContext, @Param('id') id: string) {
    return this.service.getReceipt(ctx, id)
  }

  @Get('ledger')
  @RequirePermission(Permission.REPORT_SALES)
  @ApiOperation({ summary: '应收台账（未结清出库单）' })
  ledger(@CurrentUser() ctx: RequestContext, @Query() q: LedgerQueryDto) {
    return this.service.getLedger(ctx, q)
  }

  @Get('aging')
  @RequirePermission(Permission.REPORT_SALES)
  @ApiOperation({ summary: '账龄分析（按客户分逾期段）' })
  aging(@CurrentUser() ctx: RequestContext, @Query() q: AgingQueryDto) {
    return this.service.getAging(ctx, q)
  }

  @Get('statement')
  @RequirePermission(Permission.REPORT_SALES)
  @ApiOperation({ summary: '客户对账单（发货与收款流水 + 余额）' })
  statement(@CurrentUser() ctx: RequestContext, @Query() q: StatementQueryDto) {
    return this.service.getStatement(ctx, q)
  }

  @Get('overview')
  @RequirePermission(Permission.REPORT_SALES)
  @ApiOperation({ summary: '应收总览（总应收/已收/逾期/收款合计）' })
  overview(@CurrentUser() ctx: RequestContext) {
    return this.service.getOverview(ctx)
  }
}
