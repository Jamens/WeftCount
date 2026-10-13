import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { buildXlsx, type XlsxCell } from '../../common/xlsx'
import { InventoryBatchEntity } from '../inventory/entities/inventory-batch.entity'
import { InventoryTransactionEntity } from '../inventory/entities/inventory-transaction.entity'
import { InventoryDocumentEntity } from '../inventory/entities/inventory-document.entity'
import { RollEntity } from '../inventory/entities/roll.entity'
import { MaterialEntity } from '../material/entities/material.entity'
import { GreigeSpecEntity } from '../material/entities/greige-spec.entity'
import { WarehouseEntity } from '../warehouse/entities/warehouse.entity'
import { TradeOrderEntity } from '../order/entities/trade-order.entity'
import { ProductionOrderEntity } from '../production/entities/production-order.entity'
import { ProductionReportEntity } from '../production/entities/production-report.entity'
import { MachineEntity } from '../production/entities/machine.entity'
import { StocktakeEntity } from '../stocktake/entities/stocktake.entity'
import { AuditLogEntity } from '../audit/entities/audit-log.entity'
import { CostService } from '../cost/cost.service'
import { AnalyticsService } from '../analytics/analytics.service'
import { ErrorCode } from '@weftcount/shared'
import {
  AUDIT_ACTION_CN, BATCH_SOURCE_CN, BATCH_STATUS_CN, cn, DOC_TYPE_CN,
  ORDER_STATUS_CN, ORDER_TYPE_CN, PROD_ORDER_STATUS_CN, ROLL_STATUS_CN, STOP_REASON_CN,
  STOCKTAKE_STATUS_CN, TXN_DIRECTION_CN, TXN_TYPE_CN,
} from './report-labels'

/** 导出参数：租户/公司隔离 + 可选筛选 */
export interface ReportQuery {
  tenantId: string
  companyId: string
  /** 导出前N 天内发生的数据（时间字段含当天）；不传=不限 */
  days?: number
  /** 限定某个机台 */
  machineId?: string
}

type Row = XlsxCell[]

/**
 * 通用报表导出（XLSX）
 *
 * 背景：此前**只有物料**能导出，其余报表（库存批次、流水、三算对账、成本、趋势、
 * 生产、盘点、审计）只能在页面看表格，无法带走——业务方要交月报/对账时只能手抄。
 *
 * 设计取舍：
 *  - **零依赖**：复用 `common/xlsx.ts` 自写的 xlsx 生成器，不引 ExcelJS 之类。
 *  - **批量预取**：报表常带「物料名/规格名/仓库名」这类外键列。这里一次性
 *    把涉及的 id 全部捞进 Map 再拼装，**不做逐行 await**（N+1 会让万行报表卡死）。
 *  - **口径复用现有 service**：成本、趋势直接调 `CostService` / `AnalyticsService`，
 *    保证导出数字与页面所见**完全一致**（自己重算一遍必然漂移）。
 *  - **一律带租户+公司过滤**：跨租户/跨公司数据泄漏是这类"通用查询"最危险的坑。
 */

/** 报表元信息，供前端自动渲染列表与权限说明 */
export interface ReportMeta {
  key: string
  label: string
  description: string
  /** 是否支持 days 时间窗筛选 */
  supportsDays: boolean
}

export const REPORTS: ReportMeta[] = [
  { key: 'inventory-batches', label: '库存批次', description: '当前在库各批次（物料/规格/仓库/数量/剩余/单位成本）', supportsDays: false },
  { key: 'inventory-transactions', label: '库存流水', description: '出入库明细（批次/类型/方向/变化量/结存）', supportsDays: true },
  { key: 'inventory-documents', label: '出入库单据', description: '采购入库/生产领料/销售出库单据（往来单位/金额）', supportsDays: true },
  { key: 'rolls', label: '件卡明细', description: '逐匹件卡（匹号/米数/剩余/状态）', supportsDays: false },
  { key: 'materials', label: '物料主数据', description: '物料档案（编码/大类/主单位/安全库存/标准单价）', supportsDays: false },
  { key: 'specs', label: '坯布规格', description: '规格工艺档案（幅宽/经纬密/支数/克重）', supportsDays: false },
  { key: 'warehouses', label: '仓库', description: '仓库档案与类型', supportsDays: false },
  { key: 'orders', label: '采购销售订单', description: '订单（类型/往来单位/金额/状态/交期）', supportsDays: true },
  { key: 'production-orders', label: '生产工单', description: '织造工单（规格/计划量/机台/状态/交期）', supportsDays: true },
  { key: 'production-reports', label: '报工记录', description: '报工明细（机台/产出米数/停机时长与原因）', supportsDays: true },
  { key: 'cost', label: '成本报表', description: '分规格成本与毛利（与成本报表页口径一致）', supportsDays: false },
  { key: 'trends', label: '趋势数据', description: '日产量/采购销售金额/规格占比（图表的底层数据）', supportsDays: true },
  { key: 'stocktakes', label: '盘点单', description: '盘点单头（仓库/日期/状态/差异汇总）', supportsDays: true },
  { key: 'audit-logs', label: '审计日志', description: '操作审计（操作人/动作/对象/耗时）', supportsDays: true },
]

@Injectable()
export class ReportExportService {
  private readonly log = new Logger(ReportExportService.name)

  constructor(
    @InjectRepository(InventoryBatchEntity) private readonly batches: Repository<InventoryBatchEntity>,
    @InjectRepository(InventoryTransactionEntity) private readonly txns: Repository<InventoryTransactionEntity>,
    @InjectRepository(InventoryDocumentEntity) private readonly docs: Repository<InventoryDocumentEntity>,
    @InjectRepository(RollEntity) private readonly rolls: Repository<RollEntity>,
    @InjectRepository(MaterialEntity) private readonly materials: Repository<MaterialEntity>,
    @InjectRepository(GreigeSpecEntity) private readonly specs: Repository<GreigeSpecEntity>,
    @InjectRepository(WarehouseEntity) private readonly warehouses: Repository<WarehouseEntity>,
    @InjectRepository(TradeOrderEntity) private readonly orders: Repository<TradeOrderEntity>,
    @InjectRepository(ProductionOrderEntity) private readonly prodOrders: Repository<ProductionOrderEntity>,
    @InjectRepository(ProductionReportEntity) private readonly reports: Repository<ProductionReportEntity>,
    @InjectRepository(MachineEntity) private readonly machines: Repository<MachineEntity>,
    @InjectRepository(StocktakeEntity) private readonly stocktakes: Repository<StocktakeEntity>,
    @InjectRepository(AuditLogEntity) private readonly audits: Repository<AuditLogEntity>,
    private readonly cost: CostService,
    private readonly analytics: AnalyticsService,
  ) {}

  /** 计算时间窗下界；不传 days 则返回 null（不限） */
  private since(days?: number): string | null {
    if (!days || days <= 0) return null
    // 与 AnalyticsService.trends 同口径：用 DAY() 倒推而非毫秒差，避免时区/夏令时偏差
    return new Date(Date.now() - (days - 1) * 86400_000).toISOString().slice(0, 10)
  }

  /**
   * 通用查找表：一次捞全量(按 id)→ Map，避免逐行查询
   * 量级可控（物料/规格/仓库都是主数据，几百到几千条），比按 id 批量 IN 查询更简单可靠。
   */
  private async maps() {
    const [materials, specs, warehouses] = await Promise.all([
      this.materials.find(),
      this.specs.find(),
      this.warehouses.find(),
    ])
    return {
      matName: new Map(materials.map((m) => [m.id, m.name])),
      matCode: new Map(materials.map((m) => [m.id, m.code])),
      specName: new Map(specs.map((s) => [s.id, s.name])),
      specCode: new Map(specs.map((s) => [s.id, s.code])),
      whName: new Map(warehouses.map((w) => [w.id, w.name])),
    }
  }

  private num(v: string | number | null | undefined): number {
    const n = Number(v ?? 0)
    return Number.isFinite(n) ? n : 0
  }

  /** 生成 XLSX；报表 key 不认识时抛 404（前端不该能触发） */
  async buildXlsx(key: string, q: ReportQuery): Promise<{ buffer: Buffer; rowCount: number }> {
    const { header, rows } = await this.build(key, q)
    return { buffer: buildXlsx(header, rows), rowCount: rows.length }
  }

  private async build(key: string, q: ReportQuery): Promise<{ header: string[]; rows: Row[] }> {
    switch (key) {
      case 'inventory-batches': return this.inventoryBatches(q)
      case 'inventory-transactions': return this.inventoryTransactions(q)
      case 'inventory-documents': return this.inventoryDocuments(q)
      case 'rolls': return this.rollsReport(q)
      case 'materials': return this.materialsReport(q)
      case 'specs': return this.specsReport(q)
      case 'warehouses': return this.warehousesReport(q)
      case 'orders': return this.ordersReport(q)
      case 'production-orders': return this.productionOrders(q)
      case 'production-reports': return this.productionReports(q)
      case 'cost': return this.costReport(q)
      case 'trends': return this.trendsReport(q)
      case 'stocktakes': return this.stocktakesReport(q)
      case 'audit-logs': return this.auditLogs(q)
      default:
        throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: `未知报表：${key}` })
    }
  }

  // -------------------------------------------------------------------------
  // 库存类
  // -------------------------------------------------------------------------

  private async inventoryBatches(q: ReportQuery) {
    const { matName, specName, whName } = await this.maps()
    const list = await this.batches.find({ where: { companyId: q.companyId }, order: { inboundAt: 'DESC' } })
    const header = ['批次号', '物料', '规格', '仓库', '幅宽cm', '初始数量(米)', '初始重量(kg)', '剩余数量(米)', '剩余重量(kg)', '单位成本', '来源', '状态', '入库时间']
    const rows: Row[] = list.map((b) => [
      b.batchNo,
      matName.get(b.materialId) ?? '',
      specName.get(b.specId) ?? '',
      whName.get(b.warehouseId ?? '') ?? '',
      this.num(b.widthCm),
      this.num(b.quantity),
      this.num(b.weightKg),
      this.num(b.remainingQuantity),
      this.num(b.remainingWeightKg),
      this.num(b.unitCost),
      cn(BATCH_SOURCE_CN, b.sourceType),
      cn(BATCH_STATUS_CN, b.status),
      this.dt(b.inboundAt),
    ])
    return { header, rows }
  }

  private async inventoryTransactions(q: ReportQuery) {
    const { matName, specName } = await this.maps()
    const batchNos = await this.batchNoMap(q.companyId)
    const qb = this.txns
      .createQueryBuilder('t')
      .where('t.company_id = :companyId', { companyId: q.companyId })
      .orderBy('t.created_at', 'DESC')
    const since = this.since(q.days)
    if (since) qb.andWhere('DATE(t.created_at) >= :since', { since })
    const list = await qb.getMany()
    const header = ['时间', '批次号', '物料', '规格', '类型', '方向', '变化量(米)', '变化重量(kg)', '结存数量(米)', '结存重量(kg)', '单价', '备注']
    const rows: Row[] = list.map((t) => [
      this.dt(t.createdAt),
      batchNos.get(t.batchId) ?? '',
      matName.get(t.materialId) ?? '',
      specName.get(t.specId) ?? '',
      cn(TXN_TYPE_CN, t.txnType),
      cn(TXN_DIRECTION_CN, t.direction),
      this.num(t.changeQuantity),
      this.num(t.changeWeightKg),
      this.num(t.afterQuantity),
      this.num(t.afterWeightKg),
      this.num(t.unitPrice),
      t.remark ?? '',
    ])
    return { header, rows }
  }

  private async batchNoMap(companyId: string): Promise<Map<string, string>> {
    const bs = await this.batches.find({ where: { companyId }, select: { id: true, batchNo: true } })
    return new Map(bs.map((b) => [b.id, b.batchNo]))
  }

  private async inventoryDocuments(q: ReportQuery) {
    const { matName, specName } = await this.maps()
    const qb = this.docs
      .createQueryBuilder('d')
      .where('d.company_id = :companyId', { companyId: q.companyId })
      .orderBy('d.created_at', 'DESC')
    const since = this.since(q.days)
    if (since) qb.andWhere('DATE(d.created_at) >= :since', { since })
    const list = await qb.getMany()
    const header = ['单据号', '类型', '物料', '规格', '幅宽cm', '数量(米)', '重量(kg)', '单价', '总金额', '往来单位', '订单号', '时间', '备注']
    const rows: Row[] = list.map((d) => [
      d.docNo,
      cn(DOC_TYPE_CN, d.docType),
      matName.get(d.materialId) ?? '',
      specName.get(d.specId) ?? '',
      this.num(d.widthCm),
      this.num(d.quantityM),
      this.num(d.weightKg),
      this.num(d.unitPrice),
      this.num(d.totalAmount),
      d.partnerName ?? '',
      '', // orderId 是 UUID，导出给业务方无意义；如需单号可另加关联查询
      this.dt(d.createdAt),
      d.remark ?? '',
    ])
    return { header, rows }
  }

  private async rollsReport(q: ReportQuery) {
    const batchNos = await this.batchNoMap(q.companyId)
    const list = await this.rolls.find({ where: { companyId: q.companyId }, order: { createdAt: 'DESC' } })
    const header = ['件卡号', '所属批次', '米数', '重量(kg)', '剩余米数', '剩余重量(kg)', '状态', '创建时间']
    const rows: Row[] = list.map((r) => [
      r.rollNo,
      batchNos.get(r.batchId) ?? '',
      this.num(r.meters),
      this.num(r.weightKg),
      this.num(r.remainingM),
      this.num(r.remainingKg),
      cn(ROLL_STATUS_CN, r.status),
      this.dt(r.createdAt),
    ])
    return { header, rows }
  }

  // -------------------------------------------------------------------------
  // 主数据类
  // -------------------------------------------------------------------------

  private async materialsReport(q: ReportQuery) {
    const list = await this.materials.find({ where: { companyId: q.companyId }, order: { code: 'ASC' } })
    const header = ['编码', '名称', '大类', '规格描述', '计量方式', '主单位', '安全库存', '标准单价', '状态', '备注']
    const rows: Row[] = list.map((m) => [
      m.code, m.name, m.category, m.specification, m.measureMode, m.primaryUnit,
      this.num(m.safetyStock), this.num(m.standardPrice), m.status, m.remark ?? '',
    ])
    return { header, rows }
  }

  private async specsReport(q: ReportQuery) {
    const list = await this.specs.find({ where: { companyId: q.companyId }, order: { code: 'ASC' } })
    const header = ['编码', '名称', '成品幅宽(cm)', '经密(根/英寸)', '纬密(根/英寸)', '组织', '经纱支数', '纬纱支数', '计算克重(g/m²)', '状态', '备注']
    const rows: Row[] = list.map((s) => [
      s.code, s.name, this.num(s.finishedWidth),
      this.num(s.warpDensity), this.num(s.weftDensity),
      s.weaveType,
      `${s.warpCountValue}${this.countSystemCn(s.warpCountSystem)}`,
      `${s.weftCountValue}${this.countSystemCn(s.weftCountSystem)}`,
      this.num(s.calculatedGsm), s.status, s.remark ?? '',
    ])
    return { header, rows }
  }

  /** 支数体系中文（导出给业务方看，NeS/Nm 等缩写不如中文直观） */
  private countSystemCn(v: string | null | undefined): string {
    switch (v) {
      case 'NeS': return '英支'
      case 'Nm': return '公支'
      case 'Tex': return '特克斯'
      case 'D': return '旦'
      default: return v ?? ''
    }
  }

  private async warehousesReport(q: ReportQuery) {
    const list = await this.warehouses.find({ where: { companyId: q.companyId }, order: { code: 'ASC' } })
    const header = ['编码', '名称', '类型', '状态', '备注']
    const rows: Row[] = list.map((w) => [w.code, w.name, w.type, w.status, w.remark ?? ''])
    return { header, rows }
  }

  // -------------------------------------------------------------------------
  // 订单与生产
  // -------------------------------------------------------------------------

  private async ordersReport(q: ReportQuery) {
    const qb = this.orders
      .createQueryBuilder('o')
      .where('o.company_id = :companyId', { companyId: q.companyId })
      .orderBy('o.order_no', 'DESC')
    const since = this.since(q.days)
    if (since) qb.andWhere('DATE(o.created_at) >= :since', { since })
    const list = await qb.getMany()
    const header = ['订单号', '类型', '往来单位', '总数量(米)', '总金额', '状态', '期望交期', '备注', '创建时间']
    const rows: Row[] = list.map((o) => [
      o.orderNo,
      cn(ORDER_TYPE_CN, o.orderType),
      o.partnerName ?? '',
      this.num(o.totalQuantityM),
      this.num(o.totalAmount),
      cn(ORDER_STATUS_CN, o.status),
      o.expectedDate ?? '',
      o.remark ?? '',
      this.dt(o.createdAt),
    ])
    return { header, rows }
  }

  private async productionOrders(q: ReportQuery) {
    const { specName } = await this.maps()
    const machineNames = new Map((await this.machines.find()).map((m) => [m.id, m.name]))
    const qb = this.prodOrders
      .createQueryBuilder('p')
      .where('p.company_id = :companyId', { companyId: q.companyId })
      .orderBy('p.order_no', 'DESC')
    const since = this.since(q.days)
    if (since) qb.andWhere('DATE(p.created_at) >= :since', { since })
    const list = await qb.getMany()
    const header = ['工单号', '规格', '计划产量(米)', '已产出(米)', '完成率', '机台', '状态', '计划开工', '交期', '备注', '创建时间']
    const rows: Row[] = list.map((p) => {
      const planned = this.num(p.plannedQuantityM)
      const produced = this.num(p.producedQuantityM)
      return [
        p.orderNo,
        specName.get(p.specId) ?? '',
        planned,
        produced,
        planned > 0 ? `${Math.min((produced / planned) * 100, 100).toFixed(1)}%` : '',
        p.machineId ? (machineNames.get(p.machineId) ?? '') : '',
        cn(PROD_ORDER_STATUS_CN, p.status),
        p.plannedStartDate ?? '',
        p.dueDate ?? '',
        p.remark ?? '',
        this.dt(p.createdAt),
      ]
    })
    return { header, rows }
  }

  private async productionReports(q: ReportQuery) {
    const orderNos = new Map(
      (await this.prodOrders.find({ where: { companyId: q.companyId }, select: { id: true, orderNo: true } }))
        .map((o) => [o.id, o.orderNo]),
    )
    const machineNames = new Map((await this.machines.find()).map((m) => [m.id, m.name]))
    const qb = this.reports
      .createQueryBuilder('r')
      .where('r.company_id = :companyId', { companyId: q.companyId })
      .orderBy('r.report_date', 'DESC')
    const since = this.since(q.days)
    if (since) qb.andWhere('r.report_date >= :since', { since })
    if (q.machineId) qb.andWhere('r.machine_id = :machineId', { machineId: q.machineId })
    const list = await qb.getMany()
    const header = ['报工日期', '工单号', '机台', '产出(米)', '停机(分钟)', '停机原因', '报工时间']
    const rows: Row[] = list.map((r) => [
      r.reportDate ?? '',
      orderNos.get(r.orderId) ?? '',
      machineNames.get(r.machineId) ?? '',
      this.num(r.outputM),
      this.num(r.stoppageMinutes),
      cn(STOP_REASON_CN, r.stopReason),
      this.dt(r.createdAt),
    ])
    return { header, rows }
  }

  // -------------------------------------------------------------------------
  // 分析类（复用现有 service，保证与页面口径一致）
  // -------------------------------------------------------------------------

  private async costReport(q: ReportQuery) {
    const list = await this.cost.analysis(q.tenantId, q.companyId)
    const header = [
      '规格编码', '规格名称', '经纱', '纬纱',
      '经纱单价', '经纱单价来源', '纬纱单价', '纬纱单价来源',
      '经纱单耗(kg/100m)', '纬纱单耗(kg/100m)', '加工费(元/米)',
      '材料成本(元/米)', '总成本(元/米)', '总成本(元/kg)', '总成本(元/m²)',
      '销售价(元/米)', '毛利(元/米)', '毛利率',
    ]
    const rows: Row[] = list.map((r) => [
      r.specCode, r.specName, r.warpMaterialName ?? '', r.weftMaterialName ?? '',
      r.warpYarnPrice, this.priceSourceCn(r.warpPriceSource),
      r.weftYarnPrice, this.priceSourceCn(r.weftPriceSource),
      r.warpKgPer100m, r.weftKgPer100m, r.overheadPerM,
      r.materialCostPerM, r.totalCostPerM, r.totalCostPerKg, r.totalCostPerM2,
      r.salesPricePerM ?? '',
      r.grossProfitPerM ?? '',
      r.grossMarginRate == null ? '' : `${(r.grossMarginRate * 100).toFixed(2)}%`,
    ])
    return { header, rows }
  }

  private priceSourceCn(v: string): string {
    switch (v) {
      case 'latest_purchase': return '最近采购价'
      case 'standard_price': return '标准单价'
      case 'none': return '无价格'
      default: return v
    }
  }

  private async trendsReport(q: ReportQuery) {
    const d = await this.analytics.trends(q.companyId, q.days ?? 30)
    const header = ['日期', '产量(米)', '产量(kg)', '采购金额', '销售金额', '领用折算(米)', '产出(米)', '超额损耗(米)', '产出匹数', '发货匹数']
    // specShare 是整个窗口的规格占比（不含日期），另起一块输出会破坏单表结构，
    // 故此处只导出日维度；规格占比见specs 报表与趋势页。
    const rows: Row[] = d.daily.map((p) => {
      const loss = d.loss.daily.find((l) => l.date === p.date)
      const roll = d.rolls.daily.find((r) => r.date === p.date)
      return [
        p.date,
        p.meters, p.weightKg, p.purchaseAmount, p.salesAmount,
        loss?.inputM ?? '', loss?.outputM ?? '', loss?.excessM ?? '',
        roll?.produced ?? '', roll?.shipped ?? '',
      ]
    })
    return { header, rows }
  }

  private async stocktakesReport(q: ReportQuery) {
    const { whName } = await this.maps()
    const qb = this.stocktakes
      .createQueryBuilder('s')
      .where('s.company_id = :companyId', { companyId: q.companyId })
      .orderBy('s.stocktake_date', 'DESC')
    const since = this.since(q.days)
    if (since) qb.andWhere('s.stocktake_date >= :since', { since })
    const list = await qb.getMany()
    const header = ['盘点单号', '仓库', '盘点日期', '状态', '备注', '创建时间']
    const rows: Row[] = list.map((s) => [
      s.stocktakeNo,
      whName.get(s.warehouseId) ?? '',
      s.stocktakeDate ?? '',
      cn(STOCKTAKE_STATUS_CN, s.status),
      s.remark ?? '',
      this.dt(s.createdAt),
    ])
    return { header, rows }
  }

  private async auditLogs(q: ReportQuery) {
    const qb = this.audits
      .createQueryBuilder('a')
      .where('a.company_id = :companyId', { companyId: q.companyId })
      .orderBy('a.created_at', 'DESC')
      .limit(50000) // 防一次性拖垮内存；导出上限，页面上也应提示
    const since = this.since(q.days)
    if (since) qb.andWhere('DATE(a.created_at) >= :since', { since })
    const list = await qb.getMany()
    const header = ['时间', '操作人', '姓名', '动作', '模块', '摘要', '对象类型', '对象ID', '方法', '路径', 'IP', '耗时(ms)']
    const rows: Row[] = list.map((a) => [
      this.dt(a.createdAt),
      a.username ?? '',
      a.realName ?? '',
      cn(AUDIT_ACTION_CN, a.action),
      a.module ?? '',
      a.summary ?? '',
      a.targetType ?? '',
      a.targetId ?? '',
      a.httpMethod ?? '',
      a.path ?? '',
      a.ip ?? '',
      this.num(a.durationMs),
    ])
    return { header, rows }
  }

  /** Date → 'YYYY-MM-DD HH:mm:ss'；date 列本身是 string 直接给 */
  private dt(v: Date | string | null | undefined): string {
    if (!v) return ''
    if (typeof v === 'string') return v.replace('T', ' ').slice(0, 19)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())} ${p(v.getHours())}:${p(v.getMinutes())}:${p(v.getSeconds())}`
  }
}