import { Body, Controller, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator'
import { GREIGE_GRADES, type GreigeGrade, type GradePriceMode } from '@weftcount/shared'
import { QualityService } from './quality.service'
import { DefectTypeEntity, type DefectCategory, type DefectPenaltyMode } from './entities/defect-type.entity'
import { InspectionEntity, type InspectionMode } from './entities/inspection.entity'
import { InspectionRollEntity } from './entities/inspection-roll.entity'
import { GradePriceEntity, type GradePriceScope } from './entities/grade-price.entity'
import { AuthGuard } from '../auth/guards/auth.guard'
import { CurrentUser, type RequestContext } from '../auth/auth-context'
import { Permission } from '../auth/permissions'
import { RequirePermission } from '../auth/decorators/require-permission.decorator'
import { Audit } from '../audit/audit.interceptor'

class CreateDefectTypeDto {
  @IsString() @MaxLength(32)
  code!: string

  @IsString() @MaxLength(64)
  name!: string

  @IsOptional() @IsIn(['warp', 'weft', 'stain', 'broken', 'other'])
  category?: DefectCategory

  @IsOptional() @IsIn(['by_length', 'fixed'])
  penaltyMode?: DefectPenaltyMode

  @IsOptional() @IsInt() @Min(0)
  fixedPenalty?: number

  @IsOptional() @IsInt()
  sortOrder?: number
}

class UpdateDefectTypeDto {
  @IsOptional() @IsString() @MaxLength(64)
  name?: string

  @IsOptional() @IsIn(['warp', 'weft', 'stain', 'broken', 'other'])
  category?: DefectCategory

  @IsOptional() @IsIn(['by_length', 'fixed'])
  penaltyMode?: DefectPenaltyMode

  @IsOptional() @IsInt() @Min(0)
  fixedPenalty?: number

  @IsOptional() @IsInt()
  sortOrder?: number

  @IsOptional() @IsBoolean()
  enabled?: boolean
}

class CreateInspectionDto {
  @IsOptional() @IsString()
  batchId?: string | null

  @IsOptional() @IsString()
  warehouseId?: string | null

  @IsOptional() @IsString()
  inspectedAt?: string | null

  @IsOptional() @IsIn(['full', 'sampling'])
  mode?: InspectionMode | null

  @IsOptional() @IsNumber() @Min(0)
  sampleRate?: number | null

  @IsOptional() @IsString() @MaxLength(255)
  remark?: string | null
}

class AddRollsDto {
  @IsArray() @IsString({ each: true })
  rollIds!: string[]
}

class DefectItemDto {
  @IsString()
  defectTypeId!: string

  /** 距匹头米数（裁剪排料要避开） */
  @IsOptional() @IsNumber() @Min(0)
  positionM?: number | null

  @IsOptional() @IsNumber() @Min(0)
  lengthInch?: number | null

  @IsOptional() @IsString() @MaxLength(255)
  remark?: string | null
}

class RecordDefectsDto {
  @ValidateNested({ each: true }) @Type(() => DefectItemDto)
  items!: DefectItemDto[]
}

class UpdateRollMeasureDto {
  @IsOptional() @IsNumber() @Min(0)
  meters?: number

  @IsOptional() @IsNumber() @Min(0)
  widthInch?: number

  @IsOptional() @IsString() @MaxLength(255)
  remark?: string | null
}

class GradePriceRuleDto {
  @IsEnum(GREIGE_GRADES)
  grade!: GreigeGrade

  @IsIn(['fixed', 'discount', 'delta'])
  mode!: GradePriceMode

  @IsNumber()
  value!: number
}

class UpsertGradePricesDto {
  @IsIn(['contract_item', 'spec'])
  scope!: GradePriceScope

  @IsString()
  refId!: string

  @ValidateNested({ each: true }) @Type(() => GradePriceRuleDto)
  rules!: GradePriceRuleDto[]
}

@ApiTags('质检')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('quality')
export class QualityController {
  constructor(private readonly svc: QualityService) {}

  // ------------------------------------------------------------ 疵点类型

  @Get('defect-types')
  @RequirePermission(Permission.QUALITY_VIEW)
  @ApiOperation({ summary: '疵点类型列表（首次访问自动灌行业通用初值）' })
  listDefectTypes(
    @CurrentUser() ctx: RequestContext,
    @Query('includeDisabled') includeDisabled?: string,
  ): Promise<DefectTypeEntity[]> {
    return this.svc.listDefectTypes(ctx, { includeDisabled: includeDisabled === 'true' })
  }

  @Post('defect-types')
  @RequirePermission(Permission.QUALITY_REVIEW)
  @ApiOperation({ summary: '新增疵点类型' })
  createDefectType(@CurrentUser() ctx: RequestContext, @Body() dto: CreateDefectTypeDto): Promise<DefectTypeEntity> {
    return this.svc.createDefectType(ctx, dto)
  }

  @Patch('defect-types/:id')
  @RequirePermission(Permission.QUALITY_REVIEW)
  @ApiOperation({ summary: '修改疵点类型' })
  updateDefectType(
    @CurrentUser() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateDefectTypeDto,
  ): Promise<DefectTypeEntity> {
    return this.svc.updateDefectType(ctx, id, dto)
  }

  // ------------------------------------------------------------ 检验单

  @Post('inspections')
  @RequirePermission(Permission.QUALITY_INSPECT)
  @Audit({ action: 'create', module: 'quality.inspection', targetType: 'inspection' })
  @ApiOperation({ summary: '建检验单' })
  createInspection(@CurrentUser() ctx: RequestContext, @Body() dto: CreateInspectionDto): Promise<InspectionEntity> {
    return this.svc.createInspection(ctx, dto)
  }

  @Get('inspections')
  @RequirePermission(Permission.QUALITY_VIEW)
  @ApiOperation({ summary: '检验单列表' })
  listInspections(
    @CurrentUser() ctx: RequestContext,
    @Query('status') status?: string,
    @Query('batchId') batchId?: string,
  ): Promise<InspectionEntity[]> {
    return this.svc.listInspections(ctx, { status, batchId })
  }

  @Get('inspections/:id')
  @RequirePermission(Permission.QUALITY_VIEW)
  @ApiOperation({ summary: '检验单详情（含逐匹结果与逐条疵点）' })
  getInspection(@CurrentUser() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.getInspection(ctx, id)
  }

  @Post('inspections/:id/rolls')
  @RequirePermission(Permission.QUALITY_INSPECT)
  @ApiOperation({ summary: '加入待检匹（实测匹长/门幅带默认值，可改）' })
  addRolls(
    @CurrentUser() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: AddRollsDto,
  ): Promise<InspectionRollEntity[]> {
    return this.svc.addRolls(ctx, id, dto.rollIds)
  }

  @Put('inspections/:id/rolls/:rollId/defects')
  @RequirePermission(Permission.QUALITY_INSPECT)
  @ApiOperation({ summary: '整匹替换疵点记录（扣分由服务端按类型规则算）' })
  recordDefects(
    @CurrentUser() ctx: RequestContext,
    @Param('id') id: string,
    @Param('rollId') rollId: string,
    @Body() dto: RecordDefectsDto,
  ) {
    return this.svc.recordDefects(ctx, id, rollId, dto.items)
  }

  @Patch('inspections/:id/rolls/:rollId')
  @RequirePermission(Permission.QUALITY_INSPECT)
  @ApiOperation({ summary: '改实测匹长/门幅（分母变了会重算密度与等级）' })
  updateRollMeasure(
    @CurrentUser() ctx: RequestContext,
    @Param('id') id: string,
    @Param('rollId') rollId: string,
    @Body() dto: UpdateRollMeasureDto,
  ) {
    return this.svc.updateRollMeasure(ctx, id, rollId, dto)
  }

  @Post('inspections/:id/finalize')
  @RequirePermission(Permission.QUALITY_REVIEW)
  @Audit({ action: 'update', module: 'quality.inspection', targetType: 'inspection' })
  @ApiOperation({ summary: '定等：把等级写回件卡' })
  finalize(@CurrentUser() ctx: RequestContext, @Param('id') id: string): Promise<InspectionEntity> {
    return this.svc.finalize(ctx, id)
  }

  @Post('inspections/:id/void')
  @RequirePermission(Permission.QUALITY_REVIEW)
  @Audit({ action: 'update', module: 'quality.inspection', targetType: 'inspection' })
  @ApiOperation({ summary: '作废：回退件卡等级到上一版或置为未检验' })
  voidInspection(@CurrentUser() ctx: RequestContext, @Param('id') id: string): Promise<InspectionEntity> {
    return this.svc.voidInspection(ctx, id)
  }

  // ------------------------------------------------------------ 分等价目

  @Get('grade-rules')
  @RequirePermission(Permission.QUALITY_VIEW)
  @ApiOperation({ summary: '当前定等规则（扣分密度区间）' })
  gradeRules() {
    return this.svc.gradeRules()
  }

  /**
   * 取分等单价 —— **出库/订单取价接这里**
   *
   * 只建质检模块而不接这个口子，定等就只是个标签：
   * 等级价差 5~15% 一分钱都收不回来。
   * 优先级：合同明细协议价 > 规格挂牌价 > 不分等（原价）。
   */
  @Get('price/quote')
  @RequirePermission(Permission.QUALITY_VIEW)
  @ApiOperation({ summary: '按品等取单价（合同明细协议价 > 规格挂牌价 > 原价）' })
  quotePrice(
    @CurrentUser() ctx: RequestContext,
    @Query('basePrice') basePrice: string,
    @Query('grade') grade?: GreigeGrade,
    @Query('contractItemId') contractItemId?: string,
    @Query('specId') specId?: string,
  ) {
    return this.svc.resolveUnitPrice(ctx, {
      basePrice: Number(basePrice ?? 0),
      grade: grade ?? null,
      contractItemId: contractItemId ?? null,
      specId: specId ?? null,
    })
  }

  @Get('grade-prices')
  @RequirePermission(Permission.QUALITY_VIEW)
  @ApiOperation({ summary: '分等价目列表' })
  listGradePrices(
    @CurrentUser() ctx: RequestContext,
    @Query('scope') scope: GradePriceScope,
    @Query('refId') refId: string,
  ): Promise<GradePriceEntity[]> {
    return this.svc.listGradePrices(ctx, scope, refId)
  }

  @Put('grade-prices')
  @RequirePermission(Permission.QUALITY_REVIEW)
  @ApiOperation({ summary: '保存分等价目（整组替换）' })
  upsertGradePrices(
    @CurrentUser() ctx: RequestContext,
    @Body() dto: UpsertGradePricesDto,
  ): Promise<GradePriceEntity[]> {
    return this.svc.upsertGradePrices(ctx, dto.scope, dto.refId, dto.rules)
  }
}
