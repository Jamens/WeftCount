import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'
import { Type } from 'class-transformer'
import { MaterialService } from './material.service'
import { AuthGuard } from '../auth/guards/auth.guard'
import { CurrentUser, type RequestContext } from '../auth/auth-context'
import { Permission } from '../auth/permissions'
import { RequirePermission } from '../auth/decorators/require-permission.decorator'
import { Audit } from '../audit/audit.interceptor'
import { MaterialEntity } from './entities/material.entity'
import { GreigeSpecEntity } from './entities/greige-spec.entity'
import type { CountSystem, MaterialCategoryValue, MeasureMode, WeaveType } from '@weftcount/shared'

class CountInput {
  @IsNumber({}, { message: '支数必须为数字' })
  @Min(0.0001, { message: '支数必须大于 0' })
  value!: number

  @IsEnum(['NeS', 'Nm', 'Tex', 'D'], { message: '支数体系必须是 NeS/Nm/Tex/D 之一' })
  system!: CountSystem
}

class CreateMaterialDto {
  @IsOptional() @IsString() @MaxLength(32)
  code?: string

  @IsString() @IsNotEmpty({ message: '物料名称不能为空' }) @MaxLength(128)
  name!: string

  @IsEnum(['yarn', 'greige', 'finished', 'auxiliary', 'spare'], { message: '物料大类不合法' })
  category!: MaterialCategoryValue

  @IsString() @IsNotEmpty({ message: '规格描述不能为空' }) @MaxLength(255)
  specification!: string

  @IsOptional() @IsEnum(['weight', 'length', 'area', 'count'])
  measureMode?: MeasureMode

  @IsOptional() @IsString() @MaxLength(16)
  primaryUnit?: string

  @IsOptional() @IsString({ each: true })
  allowedUnits?: string[]

  @IsOptional() @IsBoolean()
  batchManaged?: boolean

  @IsOptional() @IsNumber()
  safetyStock?: number

  /** 采购提前期/采购周期（天）：补货点 = 日均用量×(提前期+周期)+安全库存 */
  @IsOptional() @IsNumber() @Min(0, { message: '采购提前期不能为负' })
  leadTimeDays?: number

  @IsOptional() @IsNumber()
  standardPrice?: number

  @IsOptional() @IsString() @MaxLength(255)
  remark?: string
}

class UpdateMaterialDto {
  @IsOptional() @IsString() @MaxLength(32)
  code?: string

  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(128)
  name?: string

  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(255)
  specification?: string

  @IsOptional() @IsEnum(['weight', 'length', 'area', 'count'])
  measureMode?: MeasureMode

  @IsOptional() @IsString() @MaxLength(16)
  primaryUnit?: string

  @IsOptional() @IsString({ each: true })
  allowedUnits?: string[]

  @IsOptional() @IsBoolean()
  batchManaged?: boolean

  @IsOptional() @IsNumber()
  safetyStock?: number | null

  /** 采购提前期/采购周期（天） */
  @IsOptional() @IsNumber() @Min(0, { message: '采购提前期不能为负' })
  leadTimeDays?: number | null

  @IsOptional() @IsNumber()
  standardPrice?: number | null

  @IsOptional() @IsString() @MaxLength(255)
  remark?: string | null
}

/**
 * 工艺参数（试算与新建共用）
 * 刻意不包含 name / measuredGsm 等业务字段：试算是纯计算，不需要落库信息
 */
class TechParamsDto {
  @IsNumber() @Min(1, { message: '成品门幅必须大于 0' })
  finishedWidth!: number

  @IsNumber() @Min(1, { message: '经密必须大于 0' })
  warpDensity!: number

  @IsNumber() @Min(1, { message: '纬密必须大于 0' })
  weftDensity!: number

  @IsOptional() @IsEnum(['plain', 'twill', 'satin', 'jacquard', 'leno', 'pile'])
  weaveType?: WeaveType

  @ValidateNested() @Type(() => CountInput)
  warpCount!: CountInput

  @ValidateNested() @Type(() => CountInput)
  weftCount!: CountInput

  @IsOptional() @IsNumber()
  loomWidth?: number | null

  @IsOptional() @IsNumber() @Min(0)
  widthAllowance?: number

  @IsOptional() @IsNumber() @Min(0) @Max(1)
  warpLossRate?: number

  @IsOptional() @IsNumber() @Min(0) @Max(1)
  weftLossRate?: number

  @IsOptional() @IsInt() @Min(1)
  picksPerMinute?: number | null

  @IsOptional() @IsNumber() @Min(0) @Max(1)
  machineRunRate?: number
}

class CreateSpecDto extends TechParamsDto {
  @IsOptional() @IsString() @MaxLength(32)
  code?: string

  @IsString() @IsNotEmpty() @MaxLength(128)
  name!: string

  @IsOptional() @IsString()
  warpMaterialId?: string | null

  @IsOptional() @IsString()
  weftMaterialId?: string | null

  /** 加工费（元/米），制造成本 = 纱线成本 + 加工费 */
  @IsOptional() @IsNumber() @Min(0)
  overheadCostPerMeter?: number

  /** 出厂实测克重，仅用于校准，不影响计算值 */
  @IsOptional() @IsNumber()
  measuredGsm?: number | null

  @IsOptional() @IsString() @MaxLength(255)
  remark?: string
}

class UpdateSpecDto {
  @IsOptional() @IsString() @MaxLength(128)
  name?: string

  @IsOptional() @IsNumber() @Min(1)
  finishedWidth?: number

  @IsOptional() @IsNumber() @Min(1)
  warpDensity?: number

  @IsOptional() @IsNumber() @Min(1)
  weftDensity?: number

  @IsOptional() @IsEnum(['plain', 'twill', 'satin', 'jacquard', 'leno', 'pile'])
  weaveType?: WeaveType

  @IsOptional() @ValidateNested() @Type(() => CountInput)
  warpCount?: CountInput

  @IsOptional() @ValidateNested() @Type(() => CountInput)
  weftCount?: CountInput

  @IsOptional() @IsString()
  warpMaterialId?: string | null

  @IsOptional() @IsString()
  weftMaterialId?: string | null

  @IsOptional() @IsNumber()
  loomWidth?: number | null

  @IsOptional() @IsNumber() @Min(0)
  widthAllowance?: number

  @IsOptional() @IsNumber() @Min(0) @Max(1)
  warpLossRate?: number

  @IsOptional() @IsNumber() @Min(0) @Max(1)
  weftLossRate?: number

  @IsOptional() @IsInt() @Min(1)
  picksPerMinute?: number | null

  @IsOptional() @IsNumber() @Min(0) @Max(1)
  machineRunRate?: number

  /** 加工费（元/米） */
  @IsOptional() @IsNumber() @Min(0)
  overheadCostPerMeter?: number

  @IsOptional() @IsNumber()
  measuredGsm?: number | null

  @IsOptional() @IsString() @MaxLength(255)
  remark?: string
}

@ApiTags('物料主数据')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('materials')
export class MaterialController {
  constructor(private readonly svc: MaterialService) {}

  @Get('category-options')
  @ApiOperation({ summary: '物料大类选项' })
  categoryOptions(): { value: MaterialCategoryValue; label: string }[] {
    return this.svc.categoryOptions()
  }

  @Post()
  @RequirePermission(Permission.MATERIAL_EDIT)
  @Audit({ action: 'create', module: 'material', targetType: 'material' })
  @ApiOperation({ summary: '新建物料' })
  create(@CurrentUser() ctx: RequestContext, @Body() dto: CreateMaterialDto): Promise<MaterialEntity> {
    return this.svc.create(ctx.tenantId, ctx.companyId, dto)
  }

  @Get()
  @RequirePermission(Permission.MATERIAL_VIEW)
  @ApiOperation({ summary: '查询物料列表' })
  findAll(
    @CurrentUser() ctx: RequestContext,
    @Query('category') category?: MaterialCategoryValue,
    @Query('keyword') keyword?: string,
    @Query('status') status?: 'active' | 'discontinued',
  ): Promise<MaterialEntity[]> {
    return this.svc.findAll(ctx.tenantId, ctx.companyId, {
      ...(category ? { category } : {}),
      ...(keyword ? { keyword } : {}),
      ...(status ? { status } : {}),
    })
  }

  @Get(':id')
  @RequirePermission(Permission.MATERIAL_VIEW)
  @ApiOperation({ summary: '查询物料详情' })
  findOne(@CurrentUser() ctx: RequestContext, @Param('id') id: string): Promise<MaterialEntity> {
    return this.svc.findOne(ctx.tenantId, ctx.companyId, id)
  }

  @Patch(':id')
  @RequirePermission(Permission.MATERIAL_EDIT)
  @Audit({ action: 'update', module: 'material', targetType: 'material', targetIdParam: 'id' })
  @ApiOperation({ summary: '更新物料' })
  update(
    @CurrentUser() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateMaterialDto,
  ): Promise<MaterialEntity> {
    return this.svc.update(ctx.tenantId, ctx.companyId, id, dto)
  }

  @Post(':id/discontinue')
  @RequirePermission(Permission.MATERIAL_EDIT)
  @Audit({ action: 'update', module: 'material', targetType: 'material', targetIdParam: 'id' })
  @ApiOperation({ summary: '停用物料' })
  discontinue(
    @CurrentUser() ctx: RequestContext,
    @Param('id') id: string,
  ): Promise<MaterialEntity> {
    return this.svc.discontinue(ctx.tenantId, ctx.companyId, id)
  }
}

@ApiTags('坯布规格')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('greige-specs')
export class GreigeSpecController {
  constructor(private readonly svc: MaterialService) {}

  @Post()
  @RequirePermission(Permission.MATERIAL_EDIT)
  @Audit({ action: 'create', module: 'greige-spec', targetType: 'greige_spec' })
  @ApiOperation({ summary: '新建坯布规格（克重由工艺内核自动计算）' })
  create(@CurrentUser() ctx: RequestContext, @Body() dto: CreateSpecDto): Promise<GreigeSpecEntity> {
    return this.svc.createSpec(ctx.tenantId, ctx.companyId, dto)
  }

  @Get()
  @RequirePermission(Permission.MATERIAL_VIEW)
  @ApiOperation({ summary: '查询坯布规格列表' })
  findAll(
    @CurrentUser() ctx: RequestContext,
    @Query('keyword') keyword?: string,
  ): Promise<GreigeSpecEntity[]> {
    return this.svc.findSpecs(ctx.tenantId, ctx.companyId, keyword)
  }

  @Post('calculate')
  @RequirePermission(Permission.MATERIAL_VIEW)
  @ApiOperation({ summary: '试算规格（不落库，用于表单实时预览）' })
  calculate(@Body() dto: TechParamsDto) {
    return this.svc.calculateSpec({
      finishedWidth: dto.finishedWidth,
      warpDensity: dto.warpDensity,
      weftDensity: dto.weftDensity,
      warpCount: dto.warpCount,
      weftCount: dto.weftCount,
      loomWidth: dto.loomWidth ?? null,
      widthAllowance: dto.widthAllowance ?? 10,
      warpLossRate: dto.warpLossRate ?? 0.055,
      weftLossRate: dto.weftLossRate ?? 0.05,
      picksPerMinute: dto.picksPerMinute ?? null,
      machineRunRate: dto.machineRunRate ?? 0.85,
    })
  }

  @Get(':id')
  @RequirePermission(Permission.MATERIAL_VIEW)
  @ApiOperation({ summary: '查询规格详情' })
  findOne(@CurrentUser() ctx: RequestContext, @Param('id') id: string): Promise<GreigeSpecEntity> {
    return this.svc.findSpec(ctx.tenantId, ctx.companyId, id)
  }

  @Patch(':id')
  @RequirePermission(Permission.MATERIAL_EDIT)
  @Audit({ action: 'update', module: 'greige-spec', targetType: 'greige_spec', targetIdParam: 'id' })
  @ApiOperation({ summary: '更新规格（影响计算的字段变更会重算克重）' })
  update(
    @CurrentUser() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateSpecDto,
  ): Promise<GreigeSpecEntity> {
    return this.svc.updateSpec(ctx.tenantId, ctx.companyId, id, dto)
  }

  @Get(':id/snapshot')
  @RequirePermission(Permission.MATERIAL_VIEW)
  @ApiOperation({ summary: '取规格的计算快照（供单据落库）' })
  async snapshot(@CurrentUser() ctx: RequestContext, @Param('id') id: string) {
    const spec = await this.svc.findSpec(ctx.tenantId, ctx.companyId, id)
    return this.svc.getSnapshot(spec)
  }
}
