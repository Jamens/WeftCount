import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm'
import { DataSource, Like, Repository } from 'typeorm'
import { ErrorCode } from '@weftcount/shared'
import { MachineEntity, type MachineStatus } from './entities/machine.entity'
import { ProductionOrderEntity, type ProductionOrderStatus } from './entities/production-order.entity'
import { ProductionReportEntity } from './entities/production-report.entity'
import type {
  CreateMachineDto,
  CreateProductionOrderDto,
  CreateReportDto,
  ProductionOrderFilterDto,
  UpdateMachineDto,
  UpdateProductionOrderDto,
} from './production.dto'
import { MaterialService } from '../material/material.service'
import { InventoryService } from '../inventory/inventory.service'

/** 工单号前缀 SC（生产） */
const ORDER_PREFIX = 'SC'
/** 机台编码前缀 */
const MACHINE_PREFIX = 'M'

/** 允许的工单状态流转 */
const TRANSITIONS: Record<ProductionOrderStatus, ProductionOrderStatus[]> = {
  draft: ['scheduled', 'cancelled'],
  scheduled: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
}

function num(n: number, scale: number): string {
  const f = 10 ** scale
  return String(Math.round((n + Number.EPSILON) * f) / f)
}

@Injectable()
export class ProductionService {
  constructor(
    @InjectRepository(MachineEntity)
    private readonly machines: Repository<MachineEntity>,
    @InjectRepository(ProductionOrderEntity)
    private readonly orders: Repository<ProductionOrderEntity>,
    @InjectRepository(ProductionReportEntity)
    private readonly reports: Repository<ProductionReportEntity>,
    private readonly materials: MaterialService,
    private readonly inventory: InventoryService,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  // -------------------------------------------------------------------------
  // 机台
  // -------------------------------------------------------------------------

  private async nextMachineCode(companyId: string): Promise<string> {
    const last = await this.machines.findOne({
      where: { companyId, code: Like(`${MACHINE_PREFIX}%`) },
      order: { code: 'DESC' },
    })
    const nextNum = last ? Number(last.code.slice(1)) + 1 : 1
    if (!Number.isFinite(nextNum) || nextNum > 9999) {
      throw new BadRequestException({ code: ErrorCode.VALIDATION_FAILED, message: '机台编码 M9999 已用尽' })
    }
    return `${MACHINE_PREFIX}${String(nextNum).padStart(4, '0')}`
  }

  async createMachine(tenantId: string, companyId: string, dto: CreateMachineDto): Promise<MachineEntity> {
    const code = dto.code ?? (await this.nextMachineCode(companyId))
    const dup = await this.machines.findOne({ where: { companyId, code } })
    if (dup) throw new ConflictException({ code: ErrorCode.DUPLICATE_CODE, message: `机台编码 ${code} 已存在` })
    return this.machines.save(
      this.machines.create({
        tenantId,
        companyId,
        code,
        name: dto.name,
        model: dto.model ?? null,
        status: dto.status ?? 'idle',
        remark: dto.remark ?? null,
      }),
    )
  }

  async findMachines(tenantId: string, companyId: string, status?: MachineStatus): Promise<MachineEntity[]> {
    const qb = this.machines
      .createQueryBuilder('m')
      .where('m.tenant_id = :tenantId', { tenantId })
      .andWhere('m.company_id = :companyId', { companyId })
      .orderBy('m.code', 'ASC')
    if (status) qb.andWhere('m.status = :status', { status })
    return qb.getMany()
  }

  async findMachine(tenantId: string, companyId: string, id: string): Promise<MachineEntity> {
    const m = await this.machines.findOne({ where: { id, tenantId, companyId } })
    if (!m) throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: '机台不存在' })
    return m
  }

  async updateMachine(tenantId: string, companyId: string, id: string, dto: UpdateMachineDto): Promise<MachineEntity> {
    const m = await this.findMachine(tenantId, companyId, id)
    if (dto.name !== undefined) m.name = dto.name
    if (dto.model !== undefined) m.model = dto.model ?? null
    if (dto.status !== undefined) m.status = dto.status
    if (dto.remark !== undefined) m.remark = dto.remark ?? null
    return this.machines.save(m)
  }

  // -------------------------------------------------------------------------
  // 生产工单
  // -------------------------------------------------------------------------

  private async nextOrderNo(companyId: string): Promise<string> {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const last = await this.orders.findOne({
      where: { companyId, orderNo: Like(`${ORDER_PREFIX}${date}%`) },
      order: { orderNo: 'DESC' },
    })
    let next = 1
    if (last) {
      const seq = Number(last.orderNo.slice(ORDER_PREFIX.length + 8))
      if (Number.isFinite(seq)) next = seq + 1
    }
    return `${ORDER_PREFIX}${date}${String(next).padStart(4, '0')}`
  }

  /** 指派机台：机台须存在且未报废 */
  private async validateMachine(tenantId: string, companyId: string, machineId: string | null | undefined): Promise<string | null> {
    if (!machineId) return null
    const m = await this.findMachine(tenantId, companyId, machineId)
    if (m.status === 'retired') {
      throw new BadRequestException({ code: ErrorCode.VALIDATION_FAILED, message: `机台「${m.name}」已报废，不能指派` })
    }
    return m.id
  }

  async createOrder(tenantId: string, companyId: string, dto: CreateProductionOrderDto): Promise<ProductionOrderEntity> {
    const spec = await this.materials.findSpec(tenantId, companyId, dto.specId)
    const snapshot = this.materials.getSnapshot(spec)
    const machineId = await this.validateMachine(tenantId, companyId, dto.machineId)
    const orderNo = await this.nextOrderNo(companyId)
    return this.orders.save(
      this.orders.create({
        tenantId,
        companyId,
        orderNo,
        materialId: dto.materialId,
        specId: dto.specId,
        specSnapshot: snapshot,
        plannedQuantityM: num(dto.plannedQuantityM, 3),
        producedQuantityM: num(0, 3),
        machineId,
        status: 'draft',
        plannedStartDate: dto.plannedStartDate ?? null,
        dueDate: dto.dueDate ?? null,
        remark: dto.remark ?? null,
      }),
    )
  }

  async findOrders(tenantId: string, companyId: string, filter?: ProductionOrderFilterDto): Promise<ProductionOrderEntity[]> {
    const qb = this.orders
      .createQueryBuilder('o')
      .where('o.tenant_id = :tenantId', { tenantId })
      .andWhere('o.company_id = :companyId', { companyId })
      .orderBy('o.order_no', 'DESC')
    if (filter?.status) qb.andWhere('o.status = :status', { status: filter.status })
    if (filter?.machineId) qb.andWhere('o.machine_id = :machineId', { machineId: filter.machineId })
    if (filter?.keyword) qb.andWhere('o.order_no LIKE :kw', { kw: `%${filter.keyword}%` })
    return qb.getMany()
  }

  async findOrder(tenantId: string, companyId: string, id: string): Promise<ProductionOrderEntity> {
    const o = await this.orders.findOne({ where: { id, tenantId, companyId } })
    if (!o) throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: '生产工单不存在' })
    return o
  }

  /** 工单详情：含报工记录与进度 */
  async getOrderDetail(tenantId: string, companyId: string, id: string) {
    const order = await this.findOrder(tenantId, companyId, id)
    const reports = await this.reports.find({
      where: { tenantId, companyId, orderId: id },
      order: { reportDate: 'ASC', createdAt: 'ASC' },
    })
    const plannedM = Number(order.plannedQuantityM)
    const producedM = Number(order.producedQuantityM)
    const progressPct = plannedM > 0 ? Math.min((producedM / plannedM) * 100, 100) : 0
    return { order, reports, progressPct }
  }

  /** 仅 draft/scheduled 可改；计划量/机台变更不影响已产出 */
  async updateOrder(
    tenantId: string,
    companyId: string,
    id: string,
    dto: UpdateProductionOrderDto,
  ): Promise<ProductionOrderEntity> {
    const o = await this.findOrder(tenantId, companyId, id)
    if (o.status !== 'draft' && o.status !== 'scheduled') {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: `工单当前为「${o.status}」，仅草稿/已排产可编辑`,
      })
    }
    if (dto.specId !== undefined && dto.specId !== o.specId) {
      if (Number(o.producedQuantityM) > 0) {
        throw new BadRequestException({ code: ErrorCode.VALIDATION_FAILED, message: '已有产出，不能改规格' })
      }
      const spec = await this.materials.findSpec(tenantId, companyId, dto.specId)
      o.specId = dto.specId
      o.specSnapshot = this.materials.getSnapshot(spec)
    }
    if (dto.plannedQuantityM !== undefined) o.plannedQuantityM = num(dto.plannedQuantityM, 3)
    if (dto.machineId !== undefined) o.machineId = await this.validateMachine(tenantId, companyId, dto.machineId)
    if (dto.plannedStartDate !== undefined) o.plannedStartDate = dto.plannedStartDate
    if (dto.dueDate !== undefined) o.dueDate = dto.dueDate
    if (dto.remark !== undefined) o.remark = dto.remark ?? null
    return this.orders.save(o)
  }

  /** 状态流转（开工/完成/取消/排产） */
  async transition(tenantId: string, companyId: string, id: string, to: ProductionOrderStatus): Promise<ProductionOrderEntity> {
    const o = await this.findOrder(tenantId, companyId, id)
    if (!TRANSITIONS[o.status].includes(to)) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: `工单当前为「${o.status}」，不能变更为「${to}」`,
      })
    }
    // 排产/开工必须已指派机台
    if ((to === 'scheduled' || to === 'in_progress') && !o.machineId) {
      throw new BadRequestException({ code: ErrorCode.VALIDATION_FAILED, message: '请先指派机台再排产/开工' })
    }
    o.status = to
    return this.orders.save(o)
  }

  // -------------------------------------------------------------------------
  // 报工
  // -------------------------------------------------------------------------

  /**
   * 挡车工报工：在**同一事务**内完成「存报工 + 累计产出/推进状态 + 生成坯布入库批次」。
   *
   * 报工即入库：织机产出直接变成坯布库存批次（sourceType=production_in），
   * 打通「织造产出 → 坯布库存 → 销售/领用」，让三算对账的产出侧有数据。
   * 全程一个事务，任一步失败整体回滚，不会出现「报了工但没库存」。
   * 报工不可编辑/删除，产出只增不减，故满额自动完成安全。
   */
  async report(
    tenantId: string,
    companyId: string,
    userId: string,
    orderId: string,
    dto: CreateReportDto,
  ): Promise<{ report: ProductionReportEntity; order: ProductionOrderEntity; batchId: string }> {
    const o = await this.findOrder(tenantId, companyId, orderId)
    if (o.status !== 'scheduled' && o.status !== 'in_progress') {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: `工单当前为「${o.status}」，仅已排产/生产中可报工`,
      })
    }
    if (!o.machineId) {
      throw new BadRequestException({ code: ErrorCode.VALIDATION_FAILED, message: '工单未指派机台，无法报工' })
    }
    const reportDate = dto.reportDate ?? new Date().toISOString().slice(0, 10)
    const ctx = { tenantId, companyId, userId }

    const { report, order, batchId } = await this.dataSource.transaction(async (manager) => {
      const savedReport = await manager.save(
        manager.create(ProductionReportEntity, {
          tenantId,
          companyId,
          orderId,
          machineId: o.machineId as string,
          reportDate,
          outputM: num(dto.outputM, 3),
          stoppageMinutes: dto.stoppageMinutes ?? null,
          stopReason: dto.stopReason ?? null,
          operatorId: userId,
        }),
      )

      // 织造产出 → 坯布入库批次（批次 sourceDocId 指向报工，可回溯工单）
      const batch = await this.inventory.createProductionInbound(manager, ctx, {
        materialId: o.materialId,
        specId: o.specId,
        quantityM: dto.outputM,
        sourceDocId: savedReport.id,
        remark: `报工入库 · 工单 ${o.orderNo}`,
      })

      // 累加产出 + 推进状态
      const produced = Number(o.producedQuantityM) + dto.outputM
      o.producedQuantityM = num(produced, 3)
      if (o.status === 'scheduled') o.status = 'in_progress'
      if (produced >= Number(o.plannedQuantityM) - 0.01) o.status = 'completed'
      const savedOrder = await manager.save(o)
      return { report: savedReport, order: savedOrder, batchId: batch.id }
    })

    return { report, order, batchId }
  }
}
