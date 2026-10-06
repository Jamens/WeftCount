import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Like, Repository } from 'typeorm'
import { ErrorCode } from '@weftcount/shared'
import { PartnerEntity } from './entities/partner.entity'
import { SupplierCodeMappingEntity } from './entities/supplier-code-mapping.entity'
import type { CreatePartnerDto, PartnerFilterDto, UpdatePartnerDto } from './partner.dto'

export interface CreatePartnerInput extends CreatePartnerDto {}
export interface UpdatePartnerInput extends UpdatePartnerDto {}

@Injectable()
export class PartnerService {
  constructor(
    @InjectRepository(PartnerEntity)
    private readonly partners: Repository<PartnerEntity>,
    @InjectRepository(SupplierCodeMappingEntity)
    private readonly codeMappings: Repository<SupplierCodeMappingEntity>,
  ) {}

  // -------------------------------------------------------------------------
  // 供应商条码映射（扫码入库用）
  // -------------------------------------------------------------------------

  async listCodeMappings(companyId: string, supplierId?: string): Promise<SupplierCodeMappingEntity[]> {
    return this.codeMappings.find({
      where: supplierId ? { companyId, supplierId } : { companyId },
      order: { createdAt: 'DESC' },
    })
  }

  async createCodeMapping(
    tenantId: string,
    companyId: string,
    input: { supplierId: string; supplierCode: string; materialId: string; specId: string; remark?: string | null },
  ): Promise<SupplierCodeMappingEntity> {
    const code = input.supplierCode.trim()
    if (!code) throw new BadRequestException({ code: ErrorCode.VALIDATION_FAILED, message: '供应商条码不能为空' })
    const exists = await this.codeMappings.findOne({ where: { companyId, supplierId: input.supplierId, supplierCode: code } })
    if (exists) {
      throw new ConflictException({ code: ErrorCode.VALIDATION_FAILED, message: '该供应商下此条码已存在映射' })
    }
    return this.codeMappings.save(
      this.codeMappings.create({
        tenantId, companyId,
        supplierId: input.supplierId,
        supplierCode: code,
        materialId: input.materialId,
        specId: input.specId,
        remark: input.remark ?? null,
      }),
    )
  }

  async removeCodeMapping(companyId: string, id: string): Promise<void> {
    await this.codeMappings.delete({ id, companyId })
  }

  /**
   * 扫码解析：按「供应商 + 条码」查映射（不带供应商则全局查，命中多条视为歧义）。
   * 只返回 ID（supplierId/materialId/specId），名称由调用方用自己的列表解析，避免跨模块耦合。
   */
  async lookupCode(
    companyId: string,
    supplierCode: string,
    supplierId?: string,
  ): Promise<
    | { ambiguous: false; supplierId: string; materialId: string; specId: string; supplierCode: string }
    | { ambiguous: true }
    | null
  > {
    const code = supplierCode.trim()
    if (!code) return null
    const rows = await this.codeMappings.find({ where: supplierId ? { companyId, supplierId, supplierCode: code } : { companyId, supplierCode: code } })
    if (rows.length === 0) return null
    if (rows.length > 1) return { ambiguous: true }
    const m = rows[0]
    return { ambiguous: false, supplierId: m.supplierId, materialId: m.materialId, specId: m.specId, supplierCode: m.supplierCode }
  }

  /**
   * 生成往来单位编码
   * 规则：固定前缀 P + 4 位流水，如 P0001
   * 不按 supplier/customer 分前缀：单位的「身份」会变（既供又销很常见），
   * 用固定前缀避免改类型时还要改编码，也便于条码统一。
   */
  private async nextCode(companyId: string): Promise<string> {
    const last = await this.partners.findOne({
      where: { companyId, code: Like('P%') },
      order: { code: 'DESC' },
    })
    const nextNum = last ? Number(last.code.slice(1)) + 1 : 1
    if (!Number.isFinite(nextNum) || nextNum > 9999) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: '往来单位编码 P9999 已用尽，请改用其他编码规则',
      })
    }
    return `P${String(nextNum).padStart(4, '0')}`
  }

  async create(tenantId: string, companyId: string, input: CreatePartnerInput): Promise<PartnerEntity> {
    const code = input.code ?? (await this.nextCode(companyId))

    const exists = await this.partners.findOne({ where: { companyId, code } })
    if (exists) {
      throw new ConflictException({
        code: ErrorCode.DUPLICATE_CODE,
        message: `往来单位编码 ${code} 已存在`,
      })
    }

    return this.partners.save(
      this.partners.create({
        tenantId,
        companyId,
        code,
        name: input.name,
        type: input.type ?? 'supplier',
        contact: input.contact ?? null,
        phone: input.phone ?? null,
        taxNo: input.taxNo ?? null,
        address: input.address ?? null,
        bankName: input.bankName ?? null,
        bankAccount: input.bankAccount ?? null,
        status: 'active',
        remark: input.remark ?? null,
      }),
    )
  }

  async findAll(
    tenantId: string,
    companyId: string,
    filter?: PartnerFilterDto,
  ): Promise<PartnerEntity[]> {
    const qb = this.partners
      .createQueryBuilder('p')
      .where('p.tenant_id = :tenantId', { tenantId })
      .andWhere('p.company_id = :companyId', { companyId })
      .orderBy('p.code', 'ASC')

    if (filter?.type) {
      qb.andWhere('p.type = :type', { type: filter.type })
    }
    if (filter?.status) {
      qb.andWhere('p.status = :status', { status: filter.status })
    }
    if (filter?.keyword) {
      qb.andWhere(
        '(p.name LIKE :kw OR p.code LIKE :kw OR p.contact LIKE :kw OR p.phone LIKE :kw)',
        { kw: `%${filter.keyword}%` },
      )
    }
    return qb.getMany()
  }

  async findOne(tenantId: string, companyId: string, id: string): Promise<PartnerEntity> {
    const p = await this.partners.findOne({ where: { id, tenantId, companyId } })
    if (!p) {
      throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: '往来单位不存在' })
    }
    return p
  }

  async update(
    tenantId: string,
    companyId: string,
    id: string,
    input: UpdatePartnerInput,
  ): Promise<PartnerEntity> {
    const p = await this.findOne(tenantId, companyId, id)
    if (input.code && input.code !== p.code) {
      const dup = await this.partners.findOne({ where: { companyId, code: input.code } })
      if (dup) {
        throw new ConflictException({
          code: ErrorCode.DUPLICATE_CODE,
          message: `往来单位编码 ${input.code} 已存在`,
        })
      }
      p.code = input.code
    }
    if (input.name !== undefined) p.name = input.name
    if (input.type !== undefined) p.type = input.type
    if (input.contact !== undefined) p.contact = input.contact ?? null
    if (input.phone !== undefined) p.phone = input.phone ?? null
    if (input.taxNo !== undefined) p.taxNo = input.taxNo ?? null
    if (input.address !== undefined) p.address = input.address ?? null
    if (input.bankName !== undefined) p.bankName = input.bankName ?? null
    if (input.bankAccount !== undefined) p.bankAccount = input.bankAccount ?? null
    if (input.remark !== undefined) p.remark = input.remark ?? null
    return this.partners.save(p)
  }

  /**
   * 停用往来单位
   * 单据里会引用 counterparty，停用只是冻结新建业务，不删除历史关联。
   */
  async disable(tenantId: string, companyId: string, id: string): Promise<PartnerEntity> {
    const p = await this.findOne(tenantId, companyId, id)
    p.status = 'disabled'
    return this.partners.save(p)
  }
}
