import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Like, Repository } from 'typeorm'
import {
  contextFromSnapshot,
  convertQuantity,
  ErrorCode,
  type ContextParams,
  type ConversionError,
} from '@weftcount/shared'
import { TradeOrderEntity, type TradeOrderStatus, type TradeOrderType } from './entities/trade-order.entity'
import type { CreateOrderDto, OrderFilterDto, UpdateOrderDto } from './order.dto'
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
    @InjectRepository(InventoryDocumentEntity)
    private readonly docs: Repository<InventoryDocumentEntity>,
    private readonly materials: MaterialService,
    private readonly partners: PartnerService,
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
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: `往来单位「${p.name}」已停用`,
      })
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

  // -------------------------------------------------------------------------
  // 单号
  // -------------------------------------------------------------------------

  private async nextOrderNo(companyId: string, orderType: TradeOrderType): Promise<string> {
    const prefix = ORDER_PREFIX[orderType]
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    // 按「前缀+日期」过滤，避免跨类型（PO/SO）误判序号撞唯一键
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
    const views = await this.computeViews(tenantId, companyId, dto.specId, dto.orderedUnit, dto.orderedValue)
    const orderNo = await this.nextOrderNo(companyId, dto.orderType)

    return this.orders.save(
      this.orders.create({
        tenantId,
        companyId,
        orderNo,
        orderType: dto.orderType,
        partnerId: partner.id,
        partnerName: partner.name,
        materialId: dto.materialId,
        specId: dto.specId,
        specSnapshot: views.snapshot,
        orderedUnit: dto.orderedUnit,
        orderedValue: num(dto.orderedValue, 4),
        quantityM: num(views.quantityM, 3),
        weightKg: num(views.weightKg, 3),
        areaM2: num(views.areaM2, 4),
        unitPrice: dto.unitPrice != null ? num(dto.unitPrice, 4) : null,
        totalAmount: dto.unitPrice != null ? num(dto.unitPrice * views.quantityM, 2) : null,
        status: 'draft',
        expectedDate: dto.expectedDate ?? null,
        remark: dto.remark ?? null,
      }),
    )
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
    if (filter?.keyword) {
      qb.andWhere('(o.order_no LIKE :kw OR o.partner_name LIKE :kw)', { kw: `%${filter.keyword}%` })
    }
    return qb.getMany()
  }

  async findOne(tenantId: string, companyId: string, id: string): Promise<TradeOrderEntity> {
    const o = await this.orders.findOne({ where: { id, tenantId, companyId } })
    if (!o) throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: '订单不存在' })
    return o
  }

  /** 仅草稿可改；改数量/规格会重算三视图与金额 */
  async update(tenantId: string, companyId: string, id: string, dto: UpdateOrderDto): Promise<TradeOrderEntity> {
    const o = await this.findOne(tenantId, companyId, id)
    if (o.status !== 'draft') {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: `订单当前为「${o.status}」，仅草稿可编辑`,
      })
    }
    if (dto.partnerId !== undefined) {
      const partner = await this.resolvePartner(tenantId, companyId, dto.partnerId, o.orderType)
      o.partnerId = partner.id
      o.partnerName = partner.name
    }
    if (dto.remark !== undefined) o.remark = dto.remark
    if (dto.expectedDate !== undefined) o.expectedDate = dto.expectedDate

    // 物料/规格/单位/数量任一变化 → 重算三视图与金额
    const affectsCalc =
      dto.specId !== undefined ||
      dto.orderedUnit !== undefined ||
      dto.orderedValue !== undefined ||
      dto.unitPrice !== undefined
    if (affectsCalc) {
      const specId = dto.specId ?? o.specId
      const unit = dto.orderedUnit ?? o.orderedUnit
      const value = dto.orderedValue ?? Number(o.orderedValue)
      const views = await this.computeViews(tenantId, companyId, specId, unit, value)
      o.specId = specId
      o.specSnapshot = views.snapshot
      o.orderedUnit = unit
      o.orderedValue = num(value, 4)
      o.quantityM = num(views.quantityM, 3)
      o.weightKg = num(views.weightKg, 3)
      o.areaM2 = num(views.areaM2, 4)
    }
    if (dto.materialId !== undefined) o.materialId = dto.materialId
    if (dto.unitPrice !== undefined) {
      o.unitPrice = dto.unitPrice != null ? num(dto.unitPrice, 4) : null
    }
    // 金额始终按「最终 quantityM × 最终 unitPrice」重算——数量或单价任一变化都要同步，
    // 否则只改数量会留下按旧数量算出的过期金额
    const price = o.unitPrice != null ? Number(o.unitPrice) : null
    o.totalAmount = price != null ? num(price * Number(o.quantityM), 2) : null
    return this.orders.save(o)
  }

  /** 状态流转：draft→confirmed→completed，任一可 cancel */
  async transition(tenantId: string, companyId: string, id: string, to: TradeOrderStatus): Promise<TradeOrderEntity> {
    const o = await this.findOne(tenantId, companyId, id)
    const allowed = TRANSITIONS[o.status]
    if (!allowed.includes(to)) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: `订单当前为「${o.status}」，不能变更为「${to}」`,
      })
    }
    o.status = to
    return this.orders.save(o)
  }

  // -------------------------------------------------------------------------
  // 履约：单据 ↔ 订单联动
  // -------------------------------------------------------------------------

  /**
   * 校验「单据挂订单」是否合法（创建采购入库/销售出库时调用）。
   * 关联单据必须与订单严格对应，否则履约进度没有意义：
   *   - 类型匹配：采购订单↔采购入库、销售订单↔销售出库
   *   - 状态可履约：仅「已确认」订单可挂单（草稿未确认、已完成/已取消不再收单）
   *   - 往来单位、物料、规格须与订单一致（防止给 A 供应商的订单记 B 的货）
   */
  async validateLink(
    tenantId: string,
    companyId: string,
    orderId: string,
    docType: 'purchase_inbound' | 'sales_outbound',
    partnerId: string,
    materialId: string,
    specId: string,
  ): Promise<TradeOrderEntity> {
    const o = await this.findOne(tenantId, companyId, orderId)
    if (FULFILL_DOC_TYPE[o.orderType] !== docType) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: `订单类型不匹配：${ORDER_PREFIX[o.orderType]} 订单不能由${
          docType === 'purchase_inbound' ? '采购入库' : '销售出库'
        }单履约`,
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
    if (o.materialId !== materialId || o.specId !== specId) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: '物料/规格与订单不一致',
      })
    }
    return o
  }

  /**
   * 汇总某订单的已履约量（关联单据的折米合计），满额自动把订单推为「已完成」。
   * 单据不可编辑/删除，履约量只增不减，因此满额即完成是安全的。
   * 返回履约进度供调用方（创建单据后 / 订单详情）使用。
   */
  async recomputeFulfillment(
    tenantId: string,
    companyId: string,
    orderId: string,
  ): Promise<{ fulfilledM: number; orderedM: number; progressPct: number; documents: InventoryDocumentEntity[] }> {
    const o = await this.findOne(tenantId, companyId, orderId)
    const documents = await this.docs.find({
      where: { tenantId, companyId, orderId },
      order: { createdAt: 'ASC' },
    })
    const fulfilledM = documents.reduce((sum, d) => sum + Number(d.quantityM), 0)
    const orderedM = Number(o.quantityM)
    const progressPct = orderedM > 0 ? Math.min((fulfilledM / orderedM) * 100, 100) : 0

    // 满额（留 1cm 容差防浮点/进位误判）且仍为已确认 → 自动完成
    if (o.status === 'confirmed' && fulfilledM >= orderedM - 0.01) {
      o.status = 'completed'
      await this.orders.save(o)
    }
    return { fulfilledM, orderedM, progressPct, documents }
  }

  /** 订单详情：含已关联的履约单据与进度 */
  async getDetail(tenantId: string, companyId: string, id: string) {
    const order = await this.findOne(tenantId, companyId, id)
    const { fulfilledM, orderedM, progressPct, documents } = await this.recomputeFulfillment(tenantId, companyId, id)
    return { order, fulfilledM, orderedM, progressPct, documents }
  }
}
