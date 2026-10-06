import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { MaterialEntity } from '../material/entities/material.entity'
import { GreigeSpecEntity } from '../material/entities/greige-spec.entity'
import { MaterialService, type CreateMaterialInput } from '../material/material.service'
import { parseCsv, toCsv } from '../../common/csv'
import { buildXlsx } from '../../common/xlsx'
import type { MaterialCategoryValue } from '@weftcount/shared'

/** 导入结果：逐行成功/失败，失败带行号与原因 */
export interface ImportResult {
  total: number
  succeeded: number
  failed: number
  errors: { row: number; message: string }[]
}

const CATEGORY_MAP: Record<string, MaterialCategoryValue> = {
  纱线: 'yarn', yarn: 'yarn',
  坯布: 'greige', greige: 'greige',
  成品: 'finished', finished: 'finished',
  辅料: 'auxiliary', auxiliary: 'auxiliary',
  备件: 'spare', spare: 'spare',
}

@Injectable()
export class ImportExportService {
  private readonly log = new Logger(ImportExportService.name)

  constructor(
    private readonly materials: MaterialService,
    @InjectRepository(MaterialEntity)
    private readonly materialRepo: Repository<MaterialEntity>,
    @InjectRepository(GreigeSpecEntity)
    private readonly specRepo: Repository<GreigeSpecEntity>,
  ) {}

  // -------------------------------------------------------------------------
  // 物料：模板 / 导入 / 导出
  // -------------------------------------------------------------------------

  materialTemplateCsv(): string {
    const header = ['物料名称*', '大类*', '规格描述*', '计量方式', '主单位', '安全库存', '标准单价', '备注']
    const sample: string[][] = [
      ['精梳棉纱 40S', '纱线', '40S/1', 'weight', 'kg', '500', '22', '示例行，导入前可删除'],
      ['全棉府绸 120×72', '坯布', '40S 120×72', 'length', 'm', '', '', '示例行'],
    ]
    const rows: string[][] = [header, ...sample]
    return toCsv(rows, true)
  }

  async importMaterials(tenantId: string, companyId: string, csvText: string): Promise<ImportResult> {
    const rows = parseCsv(csvText)
    if (rows.length < 2) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'CSV 至少需要表头 + 1 行数据' })
    const header = rows[0].map((h) => h.trim())
    const col = (name: string) => header.indexOf(name)
    const ci = {
      name: col('物料名称*'), category: col('大类*'), spec: col('规格描述*'),
      measure: col('计量方式'), unit: col('主单位'),
      safety: col('安全库存'), price: col('标准单价'), remark: col('备注'),
    }
    if (ci.name < 0 || ci.category < 0 || ci.spec < 0) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: '表头缺少必填列：物料名称*、大类*、规格描述*' })
    }

    const result: ImportResult = { total: rows.length - 1, succeeded: 0, failed: 0, errors: [] }
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i]
      const lineNo = i + 1
      try {
        const name = (r[ci.name] ?? '').trim()
        const catRaw = (r[ci.category] ?? '').trim()
        const spec = (r[ci.spec] ?? '').trim()
        if (!name) throw new Error('物料名称为空')
        if (!spec) throw new Error('规格描述为空')
        const category = CATEGORY_MAP[catRaw]
        if (!category) throw new Error(`大类「${catRaw}」不合法（纱线/坯布/成品/辅料/备件）`)

        const input: CreateMaterialInput = {
          name, category, specification: spec,
          ...(ci.measure >= 0 && r[ci.measure] ? { measureMode: r[ci.measure].trim() as never } : {}),
          ...(ci.unit >= 0 && r[ci.unit] ? { primaryUnit: r[ci.unit].trim() } : {}),
          ...(ci.safety >= 0 && r[ci.safety] ? { safetyStock: Number(r[ci.safety]) } : {}),
          ...(ci.price >= 0 && r[ci.price] ? { standardPrice: Number(r[ci.price]) } : {}),
          ...(ci.remark >= 0 && r[ci.remark] ? { remark: r[ci.remark].trim() } : {}),
        }
        await this.materials.create(tenantId, companyId, input)
        result.succeeded++
      } catch (e) {
        result.failed++
        result.errors.push({ row: lineNo, message: e instanceof Error ? e.message : '未知错误' })
      }
    }
    this.log.log(`物料导入：成功 ${result.succeeded}，失败 ${result.failed}`)
    return result
  }

  async exportMaterialsXlsx(companyId: string): Promise<Buffer> {
    const mats = await this.materialRepo.find({ where: { companyId }, order: { code: 'ASC' } })
    const header = ['编码', '名称', '大类', '规格描述', '计量方式', '主单位', '安全库存', '标准单价', '状态', '备注']
    const rows = mats.map((m) => [
      m.code, m.name, m.category, m.specification, m.measureMode, m.primaryUnit,
      m.safetyStock ?? '', m.standardPrice ?? '', m.status, m.remark ?? '',
    ])
    return buildXlsx(header, rows)
  }

  // -------------------------------------------------------------------------
  // 规格：模板 / 导入
  // -------------------------------------------------------------------------

  specTemplateCsv(): string {
    const header = [
      '规格名称*', '成品幅宽cm*', '经密(根/英寸)*', '纬密(根/英寸)*', '组织',
      '经纱支数*', '经纱体系*', '纬纱支数*', '纬纱体系*', '上机幅宽cm', '加放量cm', '经纱损耗率', '纬纱损耗率', '备注',
    ]
    const sample: string[][] = [['全棉府绸 120×72', '150', '120', '72', 'plain', '40', 'NeS', '40', 'NeS', '150', '10', '0.055', '0.05', '示例行']]
    const rows: string[][] = [header, ...sample]
    return toCsv(rows, true)
  }

  async importSpecs(tenantId: string, companyId: string, csvText: string): Promise<ImportResult> {
    const rows = parseCsv(csvText)
    if (rows.length < 2) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'CSV 至少需要表头 + 1 行数据' })
    const header = rows[0].map((h) => h.trim())
    const col = (n: string) => header.indexOf(n)
    const need = ['规格名称*', '成品幅宽cm*', '经密(根/英寸)*', '纬密(根/英寸)*', '经纱支数*', '纬纱支数*']
    for (const n of need) {
      if (col(n) < 0) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: `表头缺少必填列：${n}` })
    }
    const g = (r: string[], n: string) => (col(n) >= 0 ? (r[col(n)] ?? '').trim() : '')
    const numOr = (s: string, d: number) => (s === '' ? d : Number(s))

    const result: ImportResult = { total: rows.length - 1, succeeded: 0, failed: 0, errors: [] }
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i]
      const lineNo = i + 1
      try {
        const name = g(r, '规格名称*')
        if (!name) throw new Error('规格名称为空')
        const width = Number(g(r, '成品幅宽cm*'))
        const warpDensity = Number(g(r, '经密(根/英寸)*'))
        const weftDensity = Number(g(r, '纬密(根/英寸)*'))
        const warpVal = Number(g(r, '经纱支数*'))
        const weftVal = Number(g(r, '纬纱支数*'))
        if (!width || !warpDensity || !weftDensity) throw new Error('幅宽/经密/纬密必须为正数')
        if (!warpVal || !weftVal) throw new Error('经/纬纱支数必须为正数')

        await this.materials.createSpec(tenantId, companyId, {
          name,
          finishedWidth: width,
          warpDensity, weftDensity,
          weaveType: (g(r, '组织') || 'plain') as never,
          warpCount: { value: warpVal, system: (g(r, '经纱体系*') || 'NeS') as never },
          weftCount: { value: weftVal, system: (g(r, '纬纱体系*') || 'NeS') as never },
          ...(g(r, '上机幅宽cm') ? { loomWidth: Number(g(r, '上机幅宽cm')) } : {}),
          ...(g(r, '加放量cm') ? { widthAllowance: Number(g(r, '加放量cm')) } : {}),
          ...(g(r, '经纱损耗率') ? { warpLossRate: Number(g(r, '经纱损耗率')) } : {}),
          ...(g(r, '纬纱损耗率') ? { weftLossRate: Number(g(r, '纬纱损耗率')) } : {}),
        })
        result.succeeded++
      } catch (e) {
        result.failed++
        result.errors.push({ row: lineNo, message: e instanceof Error ? e.message : '未知错误' })
      }
    }
    this.log.log(`规格导入：成功 ${result.succeeded}，失败 ${result.failed}`)
    return result
  }
}
