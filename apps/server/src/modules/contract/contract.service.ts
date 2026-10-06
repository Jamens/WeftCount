import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm'
import { DataSource, Like, Repository } from 'typeorm'
import { ErrorCode } from '@weftcount/shared'
import { withUniqueNo } from '../../common/util/unique-no'
import { ContractEntity, type ContractStatus } from './entities/contract.entity'
import { ContractItemEntity } from './entities/contract-item.entity'
import type { ContractFilterDto, ContractItemInput, CreateContractDto, UpdateContractDto } from './contract.dto'
import { PartnerService } from '../partner/partner.service'
import { MaterialService } from '../material/material.service'

const NO_PREFIX = 'HT'
const TRANSITIONS: Record<ContractStatus, ContractStatus[]> = {
  draft: ['active', 'cancelled'],
  active: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
}

function num(n: number, scale: number): string {
  const f = 10 ** scale
  return String(Math.round((n + Number.EPSILON) * f) / f)
}

@Injectable()
export class ContractService {
  constructor(
    @InjectRepository(ContractEntity)
    private readonly contracts: Repository<ContractEntity>,
    @InjectRepository(ContractItemEntity)
    private readonly items: Repository<ContractItemEntity>,
    private readonly partners: PartnerService,
    private readonly materials: MaterialService,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  private async nextNo(companyId: string): Promise<string> {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const last = await this.contracts.findOne({
      where: { companyId, contractNo: Like(`${NO_PREFIX}${date}%`) },
      order: { contractNo: 'DESC' },
    })
    let next = 1
    if (last) {
      const seq = Number(last.contractNo.slice(NO_PREFIX.length + 8))
      if (Number.isFinite(seq)) next = seq + 1
    }
    return `${NO_PREFIX}${date}${String(next).padStart(4, '0')}`
  }

  /** 校验往来单位：采购合同=供应商，销售合同=客户（both 通用），须启用 */
  private async resolvePartner(tenantId: string, companyId: string, partnerId: string, contractType: 'purchase' | 'sales') {
    const p = await this.partners.findOne(tenantId, companyId, partnerId)
    if (p.status !== 'active') {
      throw new BadRequestException({ code: ErrorCode.VALIDATION_FAILED, message: `往来单位「${p.name}」已停用` })
    }
    const wantSupplier = contractType === 'purchase'
    const ok = wantSupplier ? p.type === 'supplier' || p.type === 'both' : p.type === 'customer' || p.type === 'both'
    if (!ok) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: wantSupplier ? `「${p.name}」不是供应商，不能作为采购合同相对方` : `「${p.name}」不是客户，不能作为销售合同相对方`,
      })
    }
    return p
  }

  /** 校验每行明细的规格存在，并算出行金额；返回汇总 */
  private async buildItems(tenantId: string, companyId: string, items: ContractItemInput[]) {
    const rows: Array<{ materialId: string; specId: string; agreedPrice: string; agreedQuantityM: string; amount: string; remark: string | null }> = []
    let totalQty = 0
    let totalAmt = 0
    for (const it of items) {
      // 规格必须存在（用 findSpec 校验，越权取不到）
      await this.materials.findSpec(tenantId, companyId, it.specId)
      const amount = it.agreedPrice * it.agreedQuantityM
      rows.push({
        materialId: it.materialId,
        specId: it.specId,
        agreedPrice: num(it.agreedPrice, 4),
        agreedQuantityM: num(it.agreedQuantityM, 3),
        amount: num(amount, 2),
        remark: it.remark ?? null,
      })
      totalQty += it.agreedQuantityM
      totalAmt += amount
    }
    return { rows, totalQuantityM: num(totalQty, 3), totalAmount: num(totalAmt, 2) }
  }

  async create(tenantId: string, companyId: string, dto: CreateContractDto): Promise<ContractEntity> {
    const partner = await this.resolvePartner(tenantId, companyId, dto.partnerId, dto.contractType)
    const { rows, totalQuantityM, totalAmount } = await this.buildItems(tenantId, companyId, dto.items)
    // 撞号重试：生成号 + 落库整体重试
    return withUniqueNo(async () => {
      const contractNo = await this.nextNo(companyId)
      return this.dataSource.transaction(async (manager) => {
        const ct = await manager.save(
          manager.create(ContractEntity, {
            tenantId, companyId, contractNo,
            contractType: dto.contractType,
            partnerId: partner.id,
            partnerName: partner.name,
            status: 'draft',
            totalQuantityM, totalAmount,
            startDate: dto.startDate ?? null,
            endDate: dto.endDate ?? null,
            remark: dto.remark ?? null,
          }),
        )
        await manager.save(
          rows.map((r) => manager.create(ContractItemEntity, { tenantId, companyId, contractId: ct.id, ...r })),
        )
        return ct
      })
    })
  }

  async findAll(tenantId: string, companyId: string, filter?: ContractFilterDto): Promise<ContractEntity[]> {
    const qb = this.contracts
      .createQueryBuilder('c')
      .where('c.tenant_id = :tenantId', { tenantId })
      .andWhere('c.company_id = :companyId', { companyId })
      .orderBy('c.contract_no', 'DESC')
    if (filter?.contractType) qb.andWhere('c.contract_type = :contractType', { contractType: filter.contractType })
    if (filter?.status) qb.andWhere('c.status = :status', { status: filter.status })
    if (filter?.partnerId) qb.andWhere('c.partner_id = :partnerId', { partnerId: filter.partnerId })
    if (filter?.keyword) qb.andWhere('(c.contract_no LIKE :kw OR c.partner_name LIKE :kw)', { kw: `%${filter.keyword}%` })
    return qb.getMany()
  }

  async findOne(tenantId: string, companyId: string, id: string): Promise<ContractEntity> {
    const c = await this.contracts.findOne({ where: { id, tenantId, companyId } })
    if (!c) throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: '合同不存在' })
    return c
  }

  async getDetail(tenantId: string, companyId: string, id: string) {
    const contract = await this.findOne(tenantId, companyId, id)
    const items = await this.items.find({ where: { contractId: id, tenantId, companyId }, order: { createdAt: 'ASC' } })
    return { contract, items }
  }

  /** 更新草稿合同：整体替换明细行并重算汇总 */
  async update(tenantId: string, companyId: string, id: string, dto: UpdateContractDto): Promise<ContractEntity> {
    const c = await this.findOne(tenantId, companyId, id)
    if (c.status !== 'draft') {
      throw new BadRequestException({ code: ErrorCode.VALIDATION_FAILED, message: `合同当前为「${c.status}」，仅草稿可编辑` })
    }
    return this.dataSource.transaction(async (manager) => {
      if (dto.items) {
        const { rows, totalQuantityM, totalAmount } = await this.buildItems(tenantId, companyId, dto.items)
        await manager.delete(ContractItemEntity, { contractId: id, tenantId, companyId })
        await manager.save(rows.map((r) => manager.create(ContractItemEntity, { tenantId, companyId, contractId: id, ...r })))
        c.totalQuantityM = totalQuantityM
        c.totalAmount = totalAmount
      }
      if (dto.startDate !== undefined) c.startDate = dto.startDate
      if (dto.endDate !== undefined) c.endDate = dto.endDate
      if (dto.remark !== undefined) c.remark = dto.remark ?? null
      return manager.save(c)
    })
  }

  /** 状态流转：draft→active→completed，任一可 cancel */
  async transition(tenantId: string, companyId: string, id: string, to: ContractStatus): Promise<ContractEntity> {
    const c = await this.findOne(tenantId, companyId, id)
    if (!TRANSITIONS[c.status].includes(to)) {
      throw new BadRequestException({ code: ErrorCode.VALIDATION_FAILED, message: `合同当前为「${c.status}」，不能变更为「${to}」` })
    }
    // 生效前必须至少一条明细行
    if (to === 'active') {
      const n = await this.items.count({ where: { contractId: id, tenantId, companyId } })
      if (n === 0) throw new BadRequestException({ code: ErrorCode.VALIDATION_FAILED, message: '合同无明细行，不能生效' })
    }
    c.status = to
    return this.contracts.save(c)
  }

  /**
   * 查协议价：给定往来单位+规格，返回生效合同中的协议单价(元/米)。
   * 供订单建单时按合同取价（无生效合同返回 null，由调用方决定是否回落到手填价）。
   */
  async findAgreedPrice(tenantId: string, companyId: string, partnerId: string, specId: string): Promise<number | null> {
    const row = await this.items
      .createQueryBuilder('i')
      .innerJoin(ContractEntity, 'c', 'c.id = i.contract_id')
      .where('i.tenant_id = :tenantId', { tenantId })
      .andWhere('i.company_id = :companyId', { companyId })
      .andWhere('c.partner_id = :partnerId', { partnerId })
      .andWhere('i.spec_id = :specId', { specId })
      .andWhere('c.status = :status', { status: 'active' })
      .orderBy('c.contract_no', 'DESC')
      .getOne()
    return row ? Number(row.agreedPrice) : null
  }
}
