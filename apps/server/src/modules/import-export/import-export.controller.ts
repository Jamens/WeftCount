import { Body, Controller, Get, Post, Res, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { IsNotEmpty, IsString } from 'class-validator'
import type { Response } from 'express'
import { ImportExportService } from './import-export.service'
import { AuthGuard } from '../auth/guards/auth.guard'
import { CurrentUser, type RequestContext } from '../auth/auth-context'
import { Permission } from '../auth/permissions'
import { RequirePermission } from '../auth/decorators/require-permission.decorator'
import { Audit } from '../audit/audit.interceptor'

class ImportCsvDto {
  /** CSV 文本内容（前端用 FileReader 读取后提交，避免 multipart 依赖）。必须用值导入以保留校验元数据。 */
  @IsString() @IsNotEmpty({ message: 'CSV 内容不能为空' })
  csv!: string
}

@ApiTags('导入导出')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('import-export')
export class ImportExportController {
  constructor(private readonly svc: ImportExportService) {}

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
