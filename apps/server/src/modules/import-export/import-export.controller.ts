import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, Post, Query, Res, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { IsNotEmpty, IsOptional, IsString } from 'class-validator'
import type { Response } from 'express'
import { ErrorCode } from '@weftcount/shared'
import { ImportExportService } from './import-export.service'
import { REPORTS, ReportExportService } from './report-export.service'
import { AuthGuard } from '../auth/guards/auth.guard'
import { CurrentUser, type RequestContext } from '../auth/auth-context'
import { Permission, hasPermission } from '../auth/permissions'
import { RequirePermission } from '../auth/decorators/require-permission.decorator'
import { Audit } from '../audit/audit.interceptor'

class ImportCsvDto {
  /** CSV 文本内容（前端用 FileReader 读取后提交，避免 multipart 依赖）。必须用值导入以保留校验元数据。 */
  @IsString() @IsNotEmpty({ message: 'CSV 内容不能为空' })
  csv!: string
}

class ReportQueryDto {
  /** 时间窗（天）；不传=不限 */
  @IsOptional() @IsString()
  days?: string

  @IsOptional() @IsString()
  machineId?: string
}

/** 报表 key 白名单校验：只允许 kebab-case，杜绝路径穿越式输入 */
const REPORT_KEY_RE = /^[a-z][a-z0-9-]{0,39}$/

/**
 * 报表 → 所需权限（任一满足即可，与页面查看权限一致）
 *
 * 成本/趋势用 REPORT_VIEW 而非 COST_VIEW：这两个是「报表类」数据，
 * 归accountant 角色统一持有；沿用页面权限而非另立一套，
 * 保证「页面上看不到的表，导出也拿不到」。
 */
const REPORT_PERMISSION: Record<string, string[]> = {
  'inventory-batches': [Permission.INVENTORY_VIEW],
  'inventory-transactions': [Permission.INVENTORY_VIEW],
  'inventory-documents': [Permission.INVENTORY_VIEW],
  rolls: [Permission.INVENTORY_VIEW],
  materials: [Permission.MATERIAL_VIEW],
  specs: [Permission.MATERIAL_VIEW],
  warehouses: [Permission.WAREHOUSE_VIEW],
  orders: [Permission.PURCHASE_VIEW, Permission.SALES_VIEW],
  'production-orders': [Permission.PRODUCTION_VIEW],
  'production-reports': [Permission.PRODUCTION_VIEW],
  cost: [Permission.COST_VIEW, Permission.REPORT_VIEW],
  trends: [Permission.REPORT_VIEW, Permission.COST_VIEW],
  stocktakes: [Permission.INVENTORY_VIEW],
  'audit-logs': [Permission.AUDIT_VIEW],
}

@ApiTags('导入导出')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('import-export')
export class ImportExportController {
  constructor(
    private readonly svc: ImportExportService,
    private readonly reports: ReportExportService,
  ) {}

  // -------------------------------------------------------------------------
  // 通用报表导出
  // -------------------------------------------------------------------------

  @Get('reports')
  @RequirePermission(Permission.MATERIAL_VIEW)
  @ApiOperation({ summary: '可用报表清单（前端据此渲染导出入口与时间窗选项）' })
  listReports() {
    return REPORTS
  }

  @Get('reports/:key/export')
  @RequirePermission(Permission.MATERIAL_VIEW)
  @ApiOperation({ summary: '按报表 key 导出 XLSX（库存/流水/单据/件卡/主数据/订单/生产/成本/趋势/盘点/审计）' })
  async exportReport(
    @CurrentUser() ctx: RequestContext,
    @Query() q: ReportQueryDto,
    @Param('key') keyParam: string,
    @Res() res: Response,
  ) {
    const key = String(keyParam)
    if (!REPORT_KEY_RE.test(key)) {
      throw new BadRequestException({ code: ErrorCode.VALIDATION_FAILED, message: '报表标识不合法' })
    }
    // 每个报表按其数据归属校验权限：审计日志只有审计权限的人能带走，
    // 不能因为共用一个控制器就用最低门槛的物料权限把审计数据导出去。
    this.requireReportPermission(ctx, key)

    const days = q.days ? Number(q.days) : undefined
    const { buffer, rowCount } = await this.reports.buildXlsx(key, {
      tenantId: ctx.tenantId,
      companyId: ctx.companyId,
      ...(days && Number.isFinite(days) && days > 0 ? { days } : {}),
      ...(q.machineId ? { machineId: q.machineId } : {}),
    })
    const fileName = `${key}-${new Date().toISOString().slice(0, 10)}.xlsx`
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`)
    // 行数放在响应头：前端无法读 xlsx 内容，给个提示便于展示「已导出 N 行」
    res.setHeader('X-Row-Count', String(rowCount))
    res.setHeader('Access-Control-Expose-Headers', 'X-Row-Count')
    res.send(buffer)
  }

  /**
   * 报表 → 所需权限，与页面「查看该报表」的权限保持一致。
   *
   * 为什么不在方法上写@RequirePermission：那只支持固定权限码，
   * 而这里是**按路径参数动态决定**——共用一个端点却要求不同权限，只能显式校验。
   * 守住"页面看不到 = 导出不了"这条线。
   *
   * 注意必须用 `hasPermission` 而非 `ctx.permissions.includes`：
   * 角色授予的是**通配符**（仓管员持 `inventory.*`），includes 会把合法用户误判为无权。
   */
  private requireReportPermission(ctx: RequestContext, key: string): void {
    const need = REPORT_PERMISSION[key]
    if (!need) {
      // 未知 key 在这里不拦（由 service 抛 404），但也绝不默认放行
      throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: `未知报表：${key}` })
    }
    const missing = need.filter((p) => !hasPermission(ctx.permissions, p))
    if (missing.length > 0) {
      throw new ForbiddenException({
        code: ErrorCode.FORBIDDEN,
        message: '无权导出该报表，缺少权限：' + missing.join('、'),
      })
    }
  }

  // ---- 物料 ----

  @Get('materials/template')
  @RequirePermission(Permission.MATERIAL_VIEW)
  @ApiOperation({ summary: '下载物料导入模板(CSV)' })
  templateMaterials(@Res() res: Response) {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="materials-template.csv"')
    res.send(this.svc.materialTemplateCsv())
  }

  @Post('materials/import')
  @RequirePermission(Permission.MATERIAL_EDIT)
  @Audit({ action: 'create', module: 'import.material' })
  @ApiOperation({ summary: '批量导入物料(CSV)，逐行返回成功/失败' })
  importMaterials(@CurrentUser() ctx: RequestContext, @Body() dto: ImportCsvDto) {
    return this.svc.importMaterials(ctx.tenantId, ctx.companyId, dto.csv)
  }

  @Get('materials/export')
  @RequirePermission(Permission.MATERIAL_VIEW)
  @ApiOperation({ summary: '导出物料(XLSX)' })
  async exportMaterials(@CurrentUser() ctx: RequestContext, @Res() res: Response) {
    const buf = await this.svc.exportMaterialsXlsx(ctx.companyId)
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', 'attachment; filename="materials.xlsx"')
    res.send(buf)
  }

  // ---- 规格 ----

  @Get('specs/template')
  @RequirePermission(Permission.MATERIAL_VIEW)
  @ApiOperation({ summary: '下载规格导入模板(CSV)' })
  templateSpecs(@Res() res: Response) {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="specs-template.csv"')
    res.send(this.svc.specTemplateCsv())
  }

  @Post('specs/import')
  @RequirePermission(Permission.MATERIAL_EDIT)
  @Audit({ action: 'create', module: 'import.spec' })
  @ApiOperation({ summary: '批量导入规格(CSV)，逐行返回成功/失败' })
  importSpecs(@CurrentUser() ctx: RequestContext, @Body() dto: ImportCsvDto) {
    return this.svc.importSpecs(ctx.tenantId, ctx.companyId, dto.csv)
  }
}
