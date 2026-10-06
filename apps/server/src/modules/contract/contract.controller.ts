import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { ContractService } from './contract.service'
import { CreateContractDto, ContractFilterDto, UpdateContractDto } from './contract.dto'
import { ContractEntity, type ContractStatus } from './entities/contract.entity'
import { AuthGuard } from '../auth/guards/auth.guard'
import { CurrentUser, type RequestContext } from '../auth/auth-context'
import { Permission } from '../auth/permissions'
import { RequirePermission } from '../auth/decorators/require-permission.decorator'
import { Audit } from '../audit/audit.interceptor'

@ApiTags('合同 / 价格')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('contracts')
export class ContractController {
  constructor(private readonly svc: ContractService) {}

  @Post()
  @RequirePermission(Permission.CONTRACT_MANAGE)
  @Audit({ action: 'create', module: 'contract', targetType: 'contract' })
  @ApiOperation({ summary: '新建合同（带多行明细与协议价）' })
  create(@CurrentUser() ctx: RequestContext, @Body() dto: CreateContractDto): Promise<ContractEntity> {
    return this.svc.create(ctx.tenantId, ctx.companyId, dto)
  }

  @Get()
  @RequirePermission(Permission.CONTRACT_VIEW)
  @ApiOperation({ summary: '查询合同列表' })
  findAll(@CurrentUser() ctx: RequestContext, @Query() filter: ContractFilterDto): Promise<ContractEntity[]> {
    return this.svc.findAll(ctx.tenantId, ctx.companyId, filter)
  }

  @Get(':id')
  @RequirePermission(Permission.CONTRACT_VIEW)
  @ApiOperation({ summary: '合同详情（含明细行）' })
  getDetail(@CurrentUser() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.getDetail(ctx.tenantId, ctx.companyId, id)
  }

  @Patch(':id')
  @RequirePermission(Permission.CONTRACT_MANAGE)
  @Audit({ action: 'update', module: 'contract', targetIdParam: 'id' })
  @ApiOperation({ summary: '更新合同（仅草稿，整体替换明细）' })
  update(@CurrentUser() ctx: RequestContext, @Param('id') id: string, @Body() dto: UpdateContractDto): Promise<ContractEntity> {
    return this.svc.update(ctx.tenantId, ctx.companyId, id, dto)
  }

  @Post(':id/activate')
  @RequirePermission(Permission.CONTRACT_MANAGE)
  @Audit({ action: 'submit', module: 'contract', targetIdParam: 'id' })
  @ApiOperation({ summary: '合同生效（草稿→生效）' })
  activate(@CurrentUser() ctx: RequestContext, @Param('id') id: string): Promise<ContractEntity> {
    return this.svc.transition(ctx.tenantId, ctx.companyId, id, 'active')
  }

  @Post(':id/complete')
  @RequirePermission(Permission.CONTRACT_MANAGE)
  @Audit({ action: 'update', module: 'contract', targetIdParam: 'id' })
  @ApiOperation({ summary: '合同完成' })
  complete(@CurrentUser() ctx: RequestContext, @Param('id') id: string): Promise<ContractEntity> {
    return this.svc.transition(ctx.tenantId, ctx.companyId, id, 'completed')
  }

  @Post(':id/cancel')
  @RequirePermission(Permission.CONTRACT_MANAGE)
  @Audit({ action: 'cancel', module: 'contract', targetIdParam: 'id' })
  @ApiOperation({ summary: '取消合同' })
  cancel(@CurrentUser() ctx: RequestContext, @Param('id') id: string): Promise<ContractEntity> {
    return this.svc.transition(ctx.tenantId, ctx.companyId, id, 'cancelled')
  }

  @Get('price/lookup')
  @RequirePermission(Permission.CONTRACT_VIEW)
  @ApiOperation({ summary: '查协议价：按往来单位+规格返回生效合同单价(元/米)，无则 null' })
  async lookupPrice(
    @CurrentUser() ctx: RequestContext,
    @Query('partnerId') partnerId: string,
    @Query('specId') specId: string,
  ) {
    const price = await this.svc.findAgreedPrice(ctx.tenantId, ctx.companyId, partnerId, specId)
    return { price }
  }
}
