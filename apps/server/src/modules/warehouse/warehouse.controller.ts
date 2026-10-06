import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator'
import { WarehouseService, type CreateWarehouseInput, type UpdateWarehouseInput } from './warehouse.service'
import { WarehouseEntity, type WarehouseType } from './entities/warehouse.entity'
import { AuthGuard } from '../auth/guards/auth.guard'
import { CurrentUser, type RequestContext } from '../auth/auth-context'
import { Permission } from '../auth/permissions'
import { RequirePermission } from '../auth/decorators/require-permission.decorator'
import { Audit } from '../audit/audit.interceptor'

class CreateWarehouseDto implements CreateWarehouseInput {
  @IsOptional() @IsString() @MaxLength(32)
  code?: string

  @IsString() @IsNotEmpty({ message: '仓库名称不能为空' }) @MaxLength(64)
  name!: string

  @IsOptional() @IsEnum(['raw', 'greige', 'finished', 'auxiliary', 'scrap', 'other'])
  type?: WarehouseType

  @IsOptional() @IsString() @MaxLength(255)
  address?: string | null

  @IsOptional() @IsString() @MaxLength(64)
  keeper?: string | null

  @IsOptional() @IsString() @MaxLength(255)
  remark?: string | null
}

class UpdateWarehouseDto implements UpdateWarehouseInput {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(64)
  name?: string

  @IsOptional() @IsEnum(['raw', 'greige', 'finished', 'auxiliary', 'scrap', 'other'])
  type?: WarehouseType

  @IsOptional() @IsString() @MaxLength(255)
  address?: string | null

  @IsOptional() @IsString() @MaxLength(64)
  keeper?: string | null

  @IsOptional() @IsEnum(['active', 'disabled'])
  status?: 'active' | 'disabled'

  @IsOptional() @IsString() @MaxLength(255)
  remark?: string | null
}

@ApiTags('仓库管理')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('warehouses')
export class WarehouseController {
  constructor(private readonly svc: WarehouseService) {}

  @Post()
  @RequirePermission(Permission.WAREHOUSE_MANAGE)
  @Audit({ action: 'create', module: 'warehouse' })
  @ApiOperation({ summary: '新建仓库' })
  create(@CurrentUser() ctx: RequestContext, @Body() dto: CreateWarehouseDto): Promise<WarehouseEntity> {
    return this.svc.create(ctx.tenantId, ctx.companyId, dto)
  }

  @Get()
  @RequirePermission(Permission.WAREHOUSE_VIEW)
  @ApiOperation({ summary: '查询仓库列表' })
  findAll(
    @CurrentUser() ctx: RequestContext,
    @Query('status') status?: 'active' | 'disabled',
  ): Promise<WarehouseEntity[]> {
    return this.svc.findAll(ctx.tenantId, ctx.companyId, status)
  }

  @Patch(':id')
  @RequirePermission(Permission.WAREHOUSE_MANAGE)
  @Audit({ action: 'update', module: 'warehouse', targetIdParam: 'id' })
  @ApiOperation({ summary: '更新仓库' })
  update(
    @CurrentUser() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateWarehouseDto,
  ): Promise<WarehouseEntity> {
    return this.svc.update(ctx.tenantId, ctx.companyId, id, dto)
  }
}
