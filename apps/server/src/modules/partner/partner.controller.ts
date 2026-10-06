import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
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
  @Audit({ action: 'create', module: 'partner' })
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
