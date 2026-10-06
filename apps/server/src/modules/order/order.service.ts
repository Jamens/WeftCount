import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm'
import { DataSource, Like, Repository } from 'typeorm'
import {
  contextFromSnapshot,
  convertQuantity,
  ErrorCode,
  type ContextParams,
  type ConversionError,
} from '@weftcount/shared'
import { TradeOrderEntity, type TradeOrderStatus, type TradeOrderType } from './entities/trade-order.entity'
import { TradeOrderItemEntity } from './entities/trade-order-item.entity'
import type { CreateOrderDto, OrderFilterDto, OrderItemInput, UpdateOrderDto } from './order.dto'
import { InventoryDocumentEntity } from '../inventory/entities/inventory-document.entity'
import { MaterialService } from '../material/material.service'
import { PartnerService } from '../partner/partner.service'

/** 订单号前缀：PO 采购订单 / SO 销售订单 */
const ORDER_PREFIX: Record<TradeOrderType, string> = {
  purchase: 'PO',
  sales: 'SO',
}

/** 订单类型 ←→ 可履约的单据类型（采购订单由采购入库履约，销售订单由销售出库履约） */
const FULFILL_DOC_TYPE: Record<TradeOrderType, 'purchase_inbound' | 'sales_outbound'> = {
  purchase: 'purchase_inbound',
  sales: 'sales_outbound',
}

/** 允许的状态流转 */
const TRANSITIONS: Record<TradeOrderStatus, TradeOrderStatus[]> = {
  draft: ['confirmed', 'cancelled'],
  confirmed: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
}

function num(n: number, scale: number): string {
  const f = 10 ** scale
  return String(Math.round((n + Number.EPSILON) * f) / f)
}

@Injectable()
export class OrderService {
  constructor(
    @InjectRepository(TradeOrderEntity)
    private readonly orders: Repository<TradeOrderEntity>,
    @InjectRepository(TradeOrderItemEntity)
    private readonly items: Repository<TradeOrderItemEntity>,
    @InjectRepository(InventoryDocumentEntity)
    private readonly docs: Repository<InventoryDocumentEntity>,
    private readonly materials: MaterialService,
    private readonly partners: PartnerService,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  // -------------------------------------------------------------------------
  // 折算：按规格快照出三视图
  // -------------------------------------------------------------------------

  private async computeViews(
    tenantId: string,
    companyId: string,
    specId: string,
    orderedUnit: string,
    orderedValue: number,
  ): Promise<{ snapshot: ReturnType<MaterialService['getSnapshot']>; quantityM: number; weightKg: number; areaM2: number }> {
    const spec = await this.materials.findSpec(tenantId, companyId, specId)
    const snapshot = this.materials.getSnapshot(spec)
    const ctx: ContextParams = contextFromSnapshot(snapshot, Number(spec.finishedWidth))
    let meters: number
    try {
      meters = convertQuantity(orderedValue, orderedUnit, 'm', ctx).value
    } catch (e) {
      if (e instanceof Error && e.name === 'ConversionError') {
        const ce = e as ConversionError
        throw new BadRequestException({ code: ErrorCode.VALIDATION_FAILED, message: `折算失败：${ce.message}` })
      }
      throw e
    }
    if (meters <= 0) {
      throw new BadRequestException({ code: ErrorCode.VALIDATION_FAILED, message: '折算后长度必须为正' })
    }
    return {
      snapshot,
      quantityM: meters,
      weightKg: convertQuantity(meters, 'm', 'kg', ctx).value,
      areaM2: convertQuantity(meters, 'm', 'm2', ctx).value,
    }
  }

  /** 校验往来单位：采购=供应商，销售=客户（both 通用），且启用 */
  private async resolvePartner(tenantId: string, companyId: string, partnerId: string, orderType: TradeOrderType) {
    const p = await this.partners.findOne(tenantId, companyId, partnerId)
    if (p.status !== 'active') {
      throw new BadRequestException({ code: ErrorCode.VALIDATION_FAILED, message: `往来单位「${p.name}」已停用` })
    }
    const wantSupplier = orderType === 'purchase'
    const ok = wantSupplier
      ? p.type === 'supplier' || p.type === 'both'
      : p.type === 'customer' || p.type === 'both'
    if (!ok) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: wantSupplier ? `「${p.name}」不是供应商，不能下采购订单` : `「${p.name}」不是客户，不能下销售订单`,
      })
    }
    return p
  }

  /** 逐行折算并算行金额，返回可直接落库的行数据与订单头汇总 */
  private async buildItems(tenantId: string, companyId: string, items: OrderItemInput[]) {
    const rows: Array<{
      materialId: string
      specId: string
      specSnapshot: ReturnType<MaterialService['getSnapshot']>
      orderedUnit: string
      orderedValue: string
      quantityM: string
      weightKg: string
      areaM2: string
      unitPrice: string | null
      lineAmount: string | null
      contractItemId: string | null
    }> = []
    let totalM = 0
    let totalAmt = 0
    let hasPrice = false
    for (const it of items) {
      const views = await this.computeViews(tenantId, companyId, it.specId, it.orderedUnit, it.orderedValue)
      const price = it.unitPrice != null ? num(it.unitPrice, 4) : null
      const lineAmount = price != null ? num(Number(price) * views.quantityM, 2) : null
      rows.push({
        materialId: it.materialId,
        specId: it.specId,
        specSnapshot: views.snapshot,
        orderedUnit: it.orderedUnit,
        orderedValue: num(it.orderedValue, 4),
        quantityM: num(views.quantityM, 3),
        weightKg: num(views.weightKg, 3),
        areaM2: num(views.areaM2, 4),
        unitPrice: price,
        lineAmount,
        contractItemId: it.contractItemId ?? null,
      })
      totalM += views.quantityM
      if (lineAmount != null) {
        totalAmt += Number(lineAmount)
        hasPrice = true
      }
    }
    return { rows, totalQuantityM: num(totalM, 3), totalAmount: hasPrice ? num(totalAmt, 2) : null }
  }

  // -------------------------------------------------------------------------
  // 单号
  // -------------------------------------------------------------------------

  private async nextOrderNo(companyId: string, orderType: TradeOrderType): Promise<string> {
    const prefix = ORDER_PREFIX[orderType]
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const last = await this.orders.findOne({
      where: { companyId, orderNo: Like(`${prefix}${date}%`) },
      order: { orderNo: 'DESC' },
    })
    let next = 1
    if (last) {
      const seq = Number(last.orderNo.slice(prefix.length + 8))
      if (Number.isFinite(seq)) next = seq + 1
    }
    return `${prefix}${date}${String(next).padStart(4, '0')}`
  }

  // -------------------------------------------------------------------------
  // CRUD
  // -------------------------------------------------------------------------

  async create(tenantId: string, companyId: string, dto: CreateOrderDto): Promise<TradeOrderEntity> {
    const partner = await this.resolvePartner(tenantId, companyId, dto.partnerId, dto.orderType)
    const { rows, totalQuantityM, totalAmount } = await this.buildItems(tenantId, companyId, dto.items)
    const orderNo = await this.nextOrderNo(companyId, dto.orderType)

    return this.dataSource.transaction(async (manager) => {
      const o = await manager.save(
        manager.create(TradeOrderEntity, {
          tenantId, companyId, orderNo,
          orderType: dto.orderType,
          partnerId: partner.id,
          partnerName: partner.name,
          totalQuantityM,
          totalAmount,
          contractId: dto.contractId ?? null,
          status: 'draft',
          expectedDate: dto.expectedDate ?? null,
          remark: dto.remark ?? null,
        }),
      )
      await manager.save(rows.map((r) => manager.create(TradeOrderItemEntity, { tenantId, companyId, orderId: o.id, ...r })))
      return o
    })
  }

  async findAll(tenantId: string, companyId: string, filter?: OrderFilterDto): Promise<TradeOrderEntity[]> {
    const qb = this.orders
      .createQueryBuilder('o')
      .where('o.tenant_id = :tenantId', { tenantId })
      .andWhere('o.company_id = :companyId', { companyId })
      .orderBy('o.order_no', 'DESC')
    if (filter?.orderType) qb.andWhere('o.order_type = :orderType', { orderType: filter.orderType })
    if (filter?.status) qb.andWhere('o.status = :status', { status: filter.status })
    if (filter?.partnerId) qb.andWhere('o.partner_id = :partnerId', { partnerId: filter.partnerId })
    if (filter?.keyword) qb.andWhere('(o.order_no LIKE :kw OR o.partner_name LIKE :kw)', { kw: `%${filter.keyword}%` })
    return qb.getMany()
  }

  async findOne(tenantId: string, companyId: string, id: string): Promise<TradeOrderEntity> {
    const o = await this.orders.findOne({ where: { id, tenantId, companyId } })
    if (!o) throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: '订单不存在' })
    return o
  }

  async listItems(tenantId: string, companyId: string, orderId: string): Promise<TradeOrderItemEntity[]> {
    return this.items.find({ where: { orderId, tenantId, companyId }, order: { createdAt: 'ASC' } })
  }

  /** 更新草稿订单：整体替换明细行并重算汇总 */
  async update(tenantId: string, companyId: string, id: string, dto: UpdateOrderDto): Promise<TradeOrderEntity> {
    const o = await this.findOne(tenantId, companyId, id)
    if (o.status !== 'draft') {
      throw new BadRequestException({ code: ErrorCode.VALIDATION_FAILED, message: `订单当前为「${o.status}」，仅草稿可编辑` })
    }
    if (dto.partnerId !== undefined) {
      const partner = await this.resolvePartner(tenantId, companyId, dto.partnerId, o.orderType)
      o.partnerId = partner.id
      o.partnerName = partner.name
    }
    if (dto.remark !== undefined) o.remark = dto.remark ?? null
    if (dto.expectedDate !== undefined) o.expectedDate = dto.expectedDate
    if (dto.items) {
      const { rows, totalQuantityM, totalAmount } = await this.buildItems(tenantId, companyId, dto.items)
      await this.dataSource.transaction(async (manager) => {
        await manager.delete(TradeOrderItemEntity, { orderId: id, tenantId, companyId })
        await manager.save(rows.map((r) => manager.create(TradeOrderItemEntity, { tenantId, companyId, orderId: id, ...r })))
      })
      o.totalQuantityM = totalQuantityM
      o.totalAmount = totalAmount
    }
    return this.orders.save(o)
  }

  /** 状态流转：draft→confirmed→completed，任一可 cancel */
  async transition(tenantId: string, companyId: string, id: string, to: TradeOrderStatus): Promise<TradeOrderEntity> {
    const o = await this.findOne(tenantId, companyId, id)
    const allowed = TRANSITIONS[o.status]
    if (!allowed.includes(to)) {
      throw new BadRequestException({ code: ErrorCode.VALIDATION_FAILED, message: `订单当前为「${o.status}」，不能变更为「${to}」` })
    }
    o.status = to
    return this.orders.save(o)
  }

  // -------------------------------------------------------------------------
  // 履约：单据 ↔ 订单联动
  // -------------------------------------------------------------------------

  /**
   * 校验「单据挂订单」是否合法（创建采购入库/销售出库时调用）。
   * 关联单据必须与订单一致，否则履约进度没有意义：
   *   - 类型匹配：采购订单↔采购入库、销售订单↔销售出库
   *   - 状态可履约：仅「已确认」订单可挂单
   *   - 往来单位须与订单一致
   *   - 物料/规格须匹配订单中的**某一行**（多明细订单不再比对单一表头字段）
   */
  async validateLink(
    tenantId: string,
    companyId: string,
    orderId: string,
    docType: 'purchase_inbound' | 'sales_outbound',
    partnerId: string,
    materialId: string,
    specId: string,
    orderItemId?: string | null,
  ): Promise<{ order: TradeOrderEntity; orderItemId: string }> {
    const o = await this.findOne(tenantId, companyId, orderId)
    if (FULFILL_DOC_TYPE[o.orderType] !== docType) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: `订单类型不匹配：${ORDER_PREFIX[o.orderType]} 订单不能由${docType === 'purchase_inbound' ? '采购入库' : '销售出库'}单履约`,
      })
    }
    if (o.status !== 'confirmed') {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: `订单当前为「${o.status}」，仅「已确认」订单可关联单据`,
      })
    }
    if (o.partnerId !== partnerId) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: `往来单位与订单不一致（订单为「${o.partnerName}」）`,
      })
    }
    // 多明细：解析本单履约哪一行
    const items = await this.listItems(tenantId, companyId, orderId)
    const candidates = items.filter((i) => i.specId === specId && i.materialId === materialId)
    if (candidates.length === 0) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: '物料/规格不在订单明细行中',
      })
    }
    if (orderItemId) {
      const item = candidates.find((i) => i.id === orderItemId)
      if (!item) {
        throw new BadRequestException({
          code: ErrorCode.VALIDATION_FAILED,
          message: '指定的履约明细行与本单物料/规格不匹配',
        })
      }
      return { order: o, orderItemId: item.id }
    }
    // 未指定行：自动归到「同规格且尚未履约满」的首行；都满了则归到首个同规格行(进度封顶100%)
    const fulfilledByItem = await this.fulfilledByItem(tenantId, companyId, orderId)
    const notFull = candidates.find((i) => Number(i.quantityM) - (fulfilledByItem.get(i.id) ?? 0) > 0.01)
    const target = notFull ?? candidates[0]
    return { order: o, orderItemId: target.id }
  }

  /** 按明细行归集已履约米数（只统计挂了 orderItemId 的单据） */
  private async fulfilledByItem(tenantId: string, companyId: string, orderId: string): Promise<Map<string, number>> {
    const documents = await this.docs.find({ where: { tenantId, companyId, orderId } })
    const map = new Map<string, number>()
    for (const d of documents) {
      if (!d.orderItemId) continue
      map.set(d.orderItemId, (map.get(d.orderItemId) ?? 0) + Number(d.quantityM))
    }
    return map
  }

  /**
   * 汇总订单的已履约量（关联单据的折米合计），与订单头汇总量(total_quantity_m)比，
   * 满额自动把订单推为「已完成」。单据不可编辑/删除，履约量只增不减，满额即完成安全。
   */
  async recomputeFulfillment(
    tenantId: string,
    companyId: string,
    orderId: string,
  ): Promise<{
    fulfilledM: number
    orderedM: number
    progressPct: number
    documents: InventoryDocumentEntity[]
    perItem: { itemId: string; fulfilledM: number; orderedM: number; progressPct: number }[]
  }> {
    const o = await this.findOne(tenantId, companyId, orderId)
    const [items, documents] = await Promise.all([
      this.listItems(tenantId, companyId, orderId),
      this.docs.find({ where: { tenantId, companyId, orderId }, order: { createdAt: 'ASC' } }),
    ])
    const fulfilledM = documents.reduce((sum, d) => sum + Number(d.quantityM), 0)
    const orderedM = Number(o.totalQuantityM)
    const progressPct = orderedM > 0 ? Math.min((fulfilledM / orderedM) * 100, 100) : 0
    // 按行进度：单据按 orderItemId 归集
    const byItem = new Map<string, number>()
    for (const d of documents) {
      if (!d.orderItemId) continue
      byItem.set(d.orderItemId, (byItem.get(d.orderItemId) ?? 0) + Number(d.quantityM))
    }
    const perItem = items.map((i) => {
      const f = byItem.get(i.id) ?? 0
      const om = Number(i.quantityM)
      return { itemId: i.id, fulfilledM: f, orderedM: om, progressPct: om > 0 ? Math.min((f / om) * 100, 100) : 0 }
    })
    if (o.status === 'confirmed' && fulfilledM >= orderedM - 0.01) {
      o.status = 'completed'
      await this.orders.save(o)
    }
    return { fulfilledM, orderedM, progressPct, documents, perItem }
  }

  /** 订单详情：含明细行、已关联履约单据、总体与**按行**进度 */
  async getDetail(tenantId: string, companyId: string, id: string) {
    const order = await this.findOne(tenantId, companyId, id)
    const [items, fulfillment] = await Promise.all([
      this.listItems(tenantId, companyId, id),
      this.recomputeFulfillment(tenantId, companyId, id),
    ])
    return { order, items, ...fulfillment }
  }
}
