import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsDateString, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator'
import { StocktakeService } from './stocktake.service'
import { StocktakeEntity, type StocktakeStatus } from './entities/stocktake.entity'
import { AuthGuard } from '../auth/guards/auth.guard'
import { CurrentUser, type RequestContext } from '../auth/auth-context'
import { Permission } from '../auth/permissions'
import { RequirePermission } from '../auth/decorators/require-permission.decorator'
import { Audit } from '../audit/audit.interceptor'

class CreateStocktakeDto {
  @IsString() @IsNotEmpty({ message: '请选择盘点仓库' })
  warehouseId!: string

  @IsOptional() @IsDateString({}, { message: '盘点日期格式应为 YYYY-MM-DD' })
  stocktakeDate?: string | null

  @IsOptional() @IsString() @MaxLength(255)
  remark?: string | null
}

class CountRecordDto {
  @IsString() @IsNotEmpty()
  itemId!: string

  @IsNumber({}, { message: '实盘量必须为数字' })
  @Min(0, { message: '实盘量不能为负' })
  countedQuantityM!: number
}

class RecordCountsDto {
  @ValidateNested({ each: true }) @Type(() => CountRecordDto)
  records!: CountRecordDto[]
}

@ApiTags('盘点')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('stocktakes')
export class StocktakeController {
  constructor(private readonly svc: StocktakeService) {}

  @Post()
  @RequirePermission(Permission.INVENTORY_MANAGE)
  @Audit({ action: 'create', module: 'stocktake' })
  @ApiOperation({ summary: '建盘点单（快照仓内批次账面量）' })
  create(
    @CurrentUser() ctx: RequestContext,
    @Body() dto: CreateStocktakeDto,
  ): Promise<StocktakeEntity> {
    return this.svc.create(ctx, { warehouseId: dto.warehouseId, stocktakeDate: dto.stocktakeDate, remark: dto.remark })
  }

  @Get()
  @RequirePermission(Permission.INVENTORY_VIEW)
  @ApiOperation({ summary: '查询盘点单列表' })
  findAll(
    @CurrentUser() ctx: RequestContext,
    @Query('status') status?: StocktakeStatus,
  ): Promise<StocktakeEntity[]> {
    return this.svc.findAll(ctx.tenantId, ctx.companyId, status)
  }

  @Get(':id')
  @RequirePermission(Permission.INVENTORY_VIEW)
  @ApiOperation({ summary: '盘点单详情（含明细差异）' })
  getDetail(@CurrentUser() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.getDetail(ctx.tenantId, ctx.companyId, id)
  }

  @Post(':id/counts')
  @RequirePermission(Permission.INVENTORY_MANAGE)
  @Audit({ action: 'update', module: 'stocktake', targetIdParam: 'id' })
  @ApiOperation({ summary: '批量录入实盘数' })
  recordCounts(
    @CurrentUser() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: RecordCountsDto,
  ) {
    return this.svc.recordCounts(ctx.tenantId, ctx.companyId, id, dto.records)
  }

  @Post(':id/complete')
  @RequirePermission(Permission.INVENTORY_MANAGE)
  @Audit({ action: 'submit', module: 'stocktake', targetIdParam: 'id' })
  @ApiOperation({ summary: '完成盘点并过账（盘盈/盘亏调整批次与流水）' })
  complete(@CurrentUser() ctx: RequestContext, @Param('id') id: string): Promise<StocktakeEntity> {
    return this.svc.complete(ctx.tenantId, ctx.companyId, ctx.userId, id)
  }

  @Post(':id/cancel')
  @RequirePermission(Permission.INVENTORY_MANAGE)
  @Audit({ action: 'cancel', module: 'stocktake', targetIdParam: 'id' })
  @ApiOperation({ summary: '取消盘点单' })
  cancel(@CurrentUser() ctx: RequestContext, @Param('id') id: string): Promise<StocktakeEntity> {
    return this.svc.cancel(ctx.tenantId, ctx.companyId, id)
  }
}
