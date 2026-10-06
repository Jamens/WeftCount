import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator'
import { PartnerService } from './partner.service'
import { CreatePartnerDto, PartnerFilterDto, UpdatePartnerDto } from './partner.dto'
import { PartnerEntity } from './entities/partner.entity'
import { AuthGuard } from '../auth/guards/auth.guard'
import { CurrentUser, type RequestContext } from '../auth/auth-context'
import { Permission } from '../auth/permissions'
import { RequirePermission } from '../auth/decorators/require-permission.decorator'
import { Audit } from '../audit/audit.interceptor'

@ApiTags('往来单位')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('partners')
export class PartnerController {
  constructor(private readonly svc: PartnerService) {}

  @Post()
  @RequirePermission(Permission.PARTNER_EDIT)
  @Audit({ action: 'create', module: 'partner', targetType: 'partner' })
  @ApiOperation({ summary: '新建往来单位（供应商/客户）' })
  create(
    @CurrentUser() ctx: RequestContext,
    @Body() dto: CreatePartnerDto,
  ): Promise<PartnerEntity> {
    return this.svc.create(ctx.tenantId, ctx.companyId, dto)
  }

  @Get()
  @RequirePermission(Permission.PARTNER_VIEW)
  @ApiOperation({ summary: '查询往来单位列表' })
  findAll(
    @CurrentUser() ctx: RequestContext,
    @Query() filter: PartnerFilterDto,
  ): Promise<PartnerEntity[]> {
    return this.svc.findAll(ctx.tenantId, ctx.companyId, filter)
  }

  @Get(':id')
  @RequirePermission(Permission.PARTNER_VIEW)
  @ApiOperation({ summary: '查询往来单位详情' })
  findOne(
    @CurrentUser() ctx: RequestContext,
    @Param('id') id: string,
  ): Promise<PartnerEntity> {
    return this.svc.findOne(ctx.tenantId, ctx.companyId, id)
  }

  @Patch(':id')
  @RequirePermission(Permission.PARTNER_EDIT)
  @Audit({ action: 'update', module: 'partner', targetIdParam: 'id' })
  @ApiOperation({ summary: '更新往来单位' })
  update(
    @CurrentUser() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: UpdatePartnerDto,
  ): Promise<PartnerEntity> {
    return this.svc.update(ctx.tenantId, ctx.companyId, id, dto)
  }

  @Post(':id/disable')
  @RequirePermission(Permission.PARTNER_EDIT)
  @Audit({ action: 'update', module: 'partner', targetIdParam: 'id' })
  @ApiOperation({ summary: '停用往来单位' })
  disable(
    @CurrentUser() ctx: RequestContext,
    @Param('id') id: string,
  ): Promise<PartnerEntity> {
    return this.svc.disable(ctx.tenantId, ctx.companyId, id)
  }
}

// ---------------------------------------------------------------------------
// 供应商条码映射（扫码入库用）——独立路由 /supplier-codes
// ---------------------------------------------------------------------------

class CreateCodeMappingDto {
  @IsString() @IsNotEmpty({ message: '请选择供应商' })
  supplierId!: string

  @IsString() @IsNotEmpty({ message: '请输入供应商条码' })
  supplierCode!: string

  @IsString() @IsNotEmpty({ message: '请选择物料' })
  materialId!: string

  @IsString() @IsNotEmpty({ message: '请选择规格' })
  specId!: string

  @IsOptional() @IsString() @MaxLength(255)
  remark?: string | null
}

@ApiTags('供应商条码映射')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('supplier-codes')
export class SupplierCodeController {
  constructor(private readonly svc: PartnerService) {}

  @Get()
  @RequirePermission(Permission.PARTNER_VIEW)
  @ApiOperation({ summary: '查询供应商条码映射列表' })
  list(@CurrentUser() ctx: RequestContext, @Query('supplierId') supplierId?: string) {
    return this.svc.listCodeMappings(ctx.companyId, supplierId)
  }

  @Post()
  @RequirePermission(Permission.PARTNER_EDIT)
  @Audit({ action: 'create', module: 'partner.code', targetType: 'partner' })
  @ApiOperation({ summary: '新增供应商条码映射' })
  create(@CurrentUser() ctx: RequestContext, @Body() dto: CreateCodeMappingDto) {
    return this.svc.createCodeMapping(ctx.tenantId, ctx.companyId, dto)
  }

  @Delete(':id')
  @RequirePermission(Permission.PARTNER_EDIT)
  @Audit({ action: 'delete', module: 'partner.code', targetIdParam: 'id' })
  @ApiOperation({ summary: '删除供应商条码映射' })
  async remove(@CurrentUser() ctx: RequestContext, @Param('id') id: string) {
    await this.svc.removeCodeMapping(ctx.companyId, id)
    return { ok: true }
  }

  @Get('lookup')
  @RequirePermission(Permission.PARTNER_VIEW)
  @ApiOperation({ summary: '扫码解析：按条码（可选供应商）查映射，识别物料/规格/供应商' })
  lookup(@CurrentUser() ctx: RequestContext, @Query('code') code: string, @Query('supplierId') supplierId?: string) {
    return this.svc.lookupCode(ctx.companyId, code, supplierId)
  }
}
