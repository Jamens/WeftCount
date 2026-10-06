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
import { MaterialService } from '../material/material.service'
import { PartnerService } from '../partner/partner.service'

/** 订单号前缀：PO 采购订单 / SO 销售订单 */
const ORDER_PREFIX: Record<TradeOrderType, string> = {
  purchase: 'PO',
  sales: 'SO',
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
}
