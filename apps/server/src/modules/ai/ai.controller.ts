import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator'
import { LlmClient } from './llm.client'
import { PricingService } from './pricing.service'
import { LossService } from './loss.service'
import { CoefficientService } from './coefficient.service'
import { PredictionService } from './prediction.service'
import { SchedulingService } from './scheduling.service'
import { AuthGuard } from '../auth/guards/auth.guard'
import { CurrentUser, type RequestContext } from '../auth/auth-context'
import { Permission } from '../auth/permissions'
import { RequirePermission } from '../auth/decorators/require-permission.decorator'
import { Audit } from '../audit/audit.interceptor'

class QuoteDto {
  @IsString() @IsNotEmpty({ message: '请选择规格' })
  specId!: string

  @IsNumber({}, { message: '数量必须为数字' })
  @Min(0.001, { message: '数量必须大于 0' })
  quantityM!: number

  /** 目标毛利率（0~1），不传用默认 15% */
  @IsOptional() @IsNumber()
  targetMarginRate?: number
}

class ApplyCoefficientDto {
  @IsString() @IsNotEmpty({ message: '请选择规格' })
  specId!: string

  /** 校准系数 [1, 1.6] */
  @IsNumber() @Min(1)
  factor!: number
}

class PredictionDto {
  @IsString() @IsNotEmpty({ message: '请选择规格' })
  specId!: string

  /** 计划产量（米） */
  @IsNumber({}, { message: '计划产量必须为数字' })
  @Min(1, { message: '计划产量必须大于 0' })
  plannedMeters!: number
}

@ApiTags('AI 智能')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('ai')
export class AiController {
  constructor(
    private readonly pricing: PricingService,
    private readonly loss: LossService,
    private readonly coefficient: CoefficientService,
    private readonly prediction: PredictionService,
    private readonly scheduling: SchedulingService,
    private readonly llm: LlmClient,
  ) {}

  @Get('status')
  @RequirePermission(Permission.SALES_VIEW)
  @ApiOperation({ summary: 'AI 引擎状态（大模型是否已配置）' })
  status() {
    return { llmEnabled: this.llm.enabled, note: this.llm.enabled ? '大模型已接入，结论由 AI 生成' : '未配置 AI_API_KEY，结论由确定性规则兜底' }
  }

  @Post('quote')
  @RequirePermission(Permission.SALES_VIEW)
  @ApiOperation({ summary: '智能核价：确定性成本+历史价带 → 建议报价（带置信度与依据）' })
  quote(@CurrentUser() ctx: RequestContext, @Body() dto: QuoteDto) {
    return this.pricing.quote(ctx.tenantId, ctx.companyId, dto)
  }

  @Get('loss')
  @RequirePermission(Permission.COST_VIEW)
  @ApiOperation({ summary: '损耗归因：按规格算超额损耗（投料vs标准得布率vs产出）+ AI 解释建议' })
  lossAttribution(@CurrentUser() ctx: RequestContext) {
    return this.loss.attribute(ctx.tenantId, ctx.companyId)
  }

  @Get('loss/hotspots')
  @RequirePermission(Permission.COST_VIEW)
  @ApiOperation({ summary: '损耗归因到匹：按生产工单归集超额损耗 + 列出该次织造产出的件卡(定位哪次织造损多了、损出哪几匹)' })
  lossHotspots(@CurrentUser() ctx: RequestContext) {
    return this.loss.hotspots(ctx.tenantId, ctx.companyId)
  }

  @Get('coefficients')
  @RequirePermission(Permission.PRODUCTION_VIEW)
  @ApiOperation({ summary: '系数自学习：从领用/报工反推各规格实测多耗倍数，给建议校准系数' })
  async coefficients(@CurrentUser() ctx: RequestContext) {
    return this.coefficient.learn(ctx.tenantId, ctx.companyId)
  }

  @Post('coefficients/apply')
  @RequirePermission(Permission.MATERIAL_EDIT)
  @Audit({ action: 'update', module: 'ai.coefficient' })
  @ApiOperation({ summary: '应用校准系数到规格（反哺确定性引擎）' })
  async applyCoefficient(@CurrentUser() ctx: RequestContext, @Body() dto: ApplyCoefficientDto) {
    await this.coefficient.apply(ctx.tenantId, ctx.companyId, dto)
    return { ok: true }
  }

  @Post('prediction')
  @RequirePermission(Permission.PRODUCTION_VIEW)
  @ApiOperation({ summary: '用料预测：按规格工艺单耗算经/纬纱需求，对比库存给采购缺口 + AI 备料建议' })
  materialPrediction(@CurrentUser() ctx: RequestContext, @Body() dto: PredictionDto) {
    return this.prediction.advise(ctx.tenantId, ctx.companyId, dto.specId, dto.plannedMeters)
  }

  @Get('scheduling')
  @RequirePermission(Permission.PRODUCTION_VIEW)
  @ApiOperation({ summary: '排产建议：待排工单按交期(EDD)×机台产能贪心排 + AI 解读' })
  scheduleSuggestion(@CurrentUser() ctx: RequestContext) {
    return this.scheduling.advise(ctx.tenantId, ctx.companyId)
  }
}
