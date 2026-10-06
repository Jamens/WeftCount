import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Like, Repository } from 'typeorm'
import { ErrorCode } from '@weftcount/shared'
import { WarehouseEntity, type WarehouseType } from './entities/warehouse.entity'

const CODE_PREFIX = 'W'

export interface CreateWarehouseInput {
  code?: string
  name: string
  type?: WarehouseType
  address?: string | null
  keeper?: string | null
  remark?: string | null
}

export interface UpdateWarehouseInput {
  name?: string
  type?: WarehouseType
  address?: string | null
  keeper?: string | null
  status?: 'active' | 'disabled'
  remark?: string | null
}

@Injectable()
export class WarehouseService {
  constructor(
    @InjectRepository(WarehouseEntity)
    private readonly warehouses: Repository<WarehouseEntity>,
  ) {}

  private async nextCode(companyId: string): Promise<string> {
    const last = await this.warehouses.findOne({
      where: { companyId, code: Like(`${CODE_PREFIX}%`) },
      order: { code: 'DESC' },
    })
    const nextNum = last ? Number(last.code.slice(1)) + 1 : 1
    if (!Number.isFinite(nextNum) || nextNum > 9999) {
      throw new BadRequestException({ code: ErrorCode.VALIDATION_FAILED, message: '仓库编码 W9999 已用尽' })
    }
    return `${CODE_PREFIX}${String(nextNum).padStart(4, '0')}`
  }

  async create(tenantId: string, companyId: string, input: CreateWarehouseInput): Promise<WarehouseEntity> {
    const code = input.code ?? (await this.nextCode(companyId))
    const dup = await this.warehouses.findOne({ where: { companyId, code } })
    if (dup) throw new ConflictException({ code: ErrorCode.DUPLICATE_CODE, message: `仓库编码 ${code} 已存在` })
    return this.warehouses.save(
      this.warehouses.create({
        tenantId,
        companyId,
        code,
        name: input.name,
        type: input.type ?? 'other',
        address: input.address ?? null,
        keeper: input.keeper ?? null,
        status: 'active',
        remark: input.remark ?? null,
      }),
    )
  }

  async findAll(tenantId: string, companyId: string, status?: 'active' | 'disabled'): Promise<WarehouseEntity[]> {
    const qb = this.warehouses
      .createQueryBuilder('w')
      .where('w.tenant_id = :tenantId', { tenantId })
      .andWhere('w.company_id = :companyId', { companyId })
      .orderBy('w.code', 'ASC')
    if (status) qb.andWhere('w.status = :status', { status })
    return qb.getMany()
  }

  async findOne(tenantId: string, companyId: string, id: string): Promise<WarehouseEntity> {
    const w = await this.warehouses.findOne({ where: { id, tenantId, companyId } })
    if (!w) throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: '仓库不存在' })
    return w
  }

  /** 校验仓库可用（存在且启用），供调拨/建批时指定目标仓 */
  async requireActive(tenantId: string, companyId: string, id: string): Promise<WarehouseEntity> {
    const w = await this.findOne(tenantId, companyId, id)
    if (w.status !== 'active') {
      throw new BadRequestException({ code: ErrorCode.VALIDATION_FAILED, message: `仓库「${w.name}」已停用` })
    }
    return w
  }

  async update(tenantId: string, companyId: string, id: string, input: UpdateWarehouseInput): Promise<WarehouseEntity> {
    const w = await this.findOne(tenantId, companyId, id)
    if (input.name !== undefined) w.name = input.name
    if (input.type !== undefined) w.type = input.type
    if (input.address !== undefined) w.address = input.address ?? null
    if (input.keeper !== undefined) w.keeper = input.keeper ?? null
    if (input.status !== undefined) w.status = input.status
    if (input.remark !== undefined) w.remark = input.remark ?? null
    return this.warehouses.save(w)
  }

  /** 取公司第一个启用仓库，作建批默认仓；无则返回 null */
  async firstActive(tenantId: string, companyId: string): Promise<WarehouseEntity | null> {
    return this.warehouses.findOne({
      where: { tenantId, companyId, status: 'active' },
      order: { code: 'ASC' },
    })
  }
}
