import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { In, Repository } from 'typeorm'
import { ErrorCode } from '@weftcount/shared'
import { InventoryBatchEntity } from '../inventory/entities/inventory-batch.entity'
import { InventoryTransactionEntity } from '../inventory/entities/inventory-transaction.entity'
import { InventoryDocumentEntity } from '../inventory/entities/inventory-document.entity'
import { TradeOrderEntity } from '../order/entities/trade-order.entity'
import { PartnerEntity } from '../partner/entities/partner.entity'
import { ProductionOrderEntity } from '../production/entities/production-order.entity'
import { ProductionReportEntity } from '../production/entities/production-report.entity'
import { MachineEntity } from '../production/entities/machine.entity'
import { GreigeSpecEntity } from '../material/entities/greige-spec.entity'
import { WarehouseEntity } from '../warehouse/entities/warehouse.entity'

/** 批次来源链的一环 */
export type BatchOrigin =
  | {
      kind: 'production'
      report: { id: string; reportDate: string; outputM: string; stopReason: string | null }
      workOrder: { id: string; orderNo: string; status: string; plannedQuantityM: string; producedQuantityM: string; dueDate: string | null }
      machine: { id: string; code: string; name: string; model: string | null } | null
    }
  | {
      kind: 'purchase'
      purchaseDoc: { id: string; docNo: string }
      purchaseOrder: { id: string; orderNo: string; status: string } | null
      supplier: { id: string; name: string } | null
    }
  | { kind: 'transfer'; fromBatchNo: string; origin: BatchOrigin | null }
  | { kind: 'unknown'; sourceType: string; sourceDocId: string }

@Injectable()
export class TraceabilityService {
  constructor(
    @InjectRepository(InventoryBatchEntity) private readonly batches: Repository<InventoryBatchEntity>,
    @InjectRepository(InventoryTransactionEntity) private readonly txns: Repository<InventoryTransactionEntity>,
    @InjectRepository(InventoryDocumentEntity) private readonly docs: Repository<InventoryDocumentEntity>,
    @InjectRepository(TradeOrderEntity) private readonly orders: Repository<TradeOrderEntity>,
    @InjectRepository(PartnerEntity) private readonly partners: Repository<PartnerEntity>,
    @InjectRepository(ProductionOrderEntity) private readonly prodOrders: Repository<ProductionOrderEntity>,
    @InjectRepository(ProductionReportEntity) private readonly reports: Repository<ProductionReportEntity>,
    @InjectRepository(MachineEntity) private readonly machines: Repository<MachineEntity>,
    @InjectRepository(GreigeSpecEntity) private readonly specs: Repository<GreigeSpecEntity>,
    @InjectRepository(WarehouseEntity) private readonly warehouses: Repository<WarehouseEntity>,
  ) {}

  /** 递归追溯批次来源（防环：同一批次只展开一次） */
  private async traceOrigin(batch: InventoryBatchEntity, visited: Set<string>, depth = 0): Promise<BatchOrigin> {
    if (visited.has(batch.id) || depth > 5) return { kind: 'unknown', sourceType: batch.sourceType, sourceDocId: batch.sourceDocId }
    visited.add(batch.id)

    if (batch.sourceType === 'production_in') {
      const report = await this.reports.findOne({ where: { id: batch.sourceDocId } })
      if (!report) return { kind: 'unknown', sourceType: batch.sourceType, sourceDocId: batch.sourceDocId }
      const wo = await this.prodOrders.findOne({ where: { id: report.orderId } })
      const machine = wo?.machineId ? await this.machines.findOne({ where: { id: wo.machineId } }) : null
      return {
        kind: 'production',
        report: { id: report.id, reportDate: report.reportDate, outputM: report.outputM, stopReason: report.stopReason },
        workOrder: wo
          ? {
              id: wo.id,
              orderNo: wo.orderNo,
              status: wo.status,
              plannedQuantityM: wo.plannedQuantityM,
              producedQuantityM: wo.producedQuantityM,
              dueDate: wo.dueDate,
            }
          : { id: '', orderNo: '(工单已删除)', status: 'unknown', plannedQuantityM: '0', producedQuantityM: '0', dueDate: null },
        machine: machine ? { id: machine.id, code: machine.code, name: machine.name, model: machine.model } : null,
      }
    }

    if (batch.sourceType === 'purchase_inbound') {
      const doc = await this.docs.findOne({ where: { id: batch.sourceDocId } })
      if (!doc) return { kind: 'unknown', sourceType: batch.sourceType, sourceDocId: batch.sourceDocId }
      const order = doc.orderId ? await this.orders.findOne({ where: { id: doc.orderId } }) : null
      const supplier = doc.partnerId ? await this.partners.findOne({ where: { id: doc.partnerId } }) : null
      return {
        kind: 'purchase',
        purchaseDoc: { id: doc.id, docNo: doc.docNo },
        purchaseOrder: order ? { id: order.id, orderNo: order.orderNo, status: order.status } : null,
        supplier: supplier ? { id: supplier.id, name: supplier.name } : null,
      }
    }

    if (batch.sourceType === 'stock_transfer') {
      // 调拨批次来源是另一个批次，递归追溯其最初来源
      const src = await this.batches.findOne({ where: { id: batch.sourceDocId } })
      if (!src) return { kind: 'unknown', sourceType: batch.sourceType, sourceDocId: batch.sourceDocId }
      return { kind: 'transfer', fromBatchNo: src.batchNo, origin: await this.traceOrigin(src, visited, depth + 1) }
    }

    return { kind: 'unknown', sourceType: batch.sourceType, sourceDocId: batch.sourceDocId }
  }

  private async specBrief(specId: string) {
    const s = await this.specs.findOne({ where: { id: specId } })
    if (!s) return null
    const snap = s.lastSnapshot as { totalGsm?: number; warpKgPer100m?: number; weftKgPer100m?: number } | null
    return {
      id: s.id,
      code: s.code,
      name: s.name,
      finishedWidth: s.finishedWidth,
      warpCount: `${s.warpCountValue} ${s.warpCountSystem}`,
      weftCount: `${s.weftCountValue} ${s.weftCountSystem}`,
      totalGsm: snap?.totalGsm ?? Number(s.calculatedGsm),
    }
  }

  /**
   * 销售单倒查：这匹布是怎么来的？
   * 销售单 → 订单/客户 → 消耗的批次 → 每批来源（生产工单/机台 或 采购/供应商 或 调拨递归）
   */
  async traceSalesDoc(tenantId: string, companyId: string, docId: string) {
    const doc = await this.docs.findOne({ where: { id: docId, tenantId, companyId } })
    if (!doc) throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: '单据不存在' })
    const customer = doc.partnerId ? await this.partners.findOne({ where: { id: doc.partnerId } }) : null
    const order = doc.orderId ? await this.orders.findOne({ where: { id: doc.orderId } }) : null

    // 该销售出库单消耗的批次（txnType=sales_out，docId=本单）
    const outTxns = await this.txns.find({ where: { docId: doc.id, txnType: 'sales_out', tenantId, companyId } })
    const batchIds = [...new Set(outTxns.map((t) => t.batchId))]
    const batches = batchIds.length ? await this.batches.find({ where: { id: In(batchIds) } }) : []
    // 批次所在仓库名（懒查一次缓存）
    const whIds = [...new Set(batches.map((b) => b.warehouseId).filter((v): v is string => !!v))]
    const whs = whIds.length ? await this.warehouses.find({ where: { id: In(whIds) } }) : []
    const whName = new Map(whs.map((w) => [w.id, w.name]))
    const visited = new Set<string>()
    const consumedBatches: Array<{
      batchNo: string
      warehouseName: string | null
      consumedM: number
      consumedKg: number
      origin: BatchOrigin
    }> = []
    for (const t of outTxns) {
      const b = batches.find((x) => x.id === t.batchId)
      if (!b) continue
      consumedBatches.push({
        batchNo: b.batchNo,
        warehouseName: b.warehouseId ? (whName.get(b.warehouseId) ?? b.warehouseId) : null,
        consumedM: Math.abs(Number(t.changeQuantity)),
        consumedKg: Math.abs(Number(t.changeWeightKg)),
        origin: await this.traceOrigin(b, visited),
      })
    }

    return {
      salesDoc: {
        id: doc.id,
        docNo: doc.docNo,
        docType: doc.docType,
        partnerName: doc.partnerName,
        quantityM: doc.quantityM,
        weightKg: doc.weightKg,
        areaM2: doc.areaM2,
        createdAt: doc.createdAt,
      },
      salesOrder: order ? { id: order.id, orderNo: order.orderNo, status: order.status } : null,
      customer: customer ? { id: customer.id, name: customer.name } : null,
      spec: await this.specBrief(doc.specId),
      consumedBatches,
    }
  }

  /**
   * 批次双向追溯：这批布从哪来、到哪去。
   * origin = 来源链（工单/机台 或 采购/供应商 或 调拨递归）；consumedBy = 消耗它的出库单据。
   */
  async traceBatch(tenantId: string, companyId: string, batchId: string) {
    const batch = await this.batches.findOne({ where: { id: batchId, tenantId, companyId } })
    if (!batch) throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: '批次不存在' })

    // 正向：哪些出库流水消耗了这批（含 doc 信息）
    const outTxns = await this.txns.find({ where: { batchId: batch.id, tenantId, companyId } })
    const outDocIds = [...new Set(outTxns.filter((t) => t.direction === 'out').map((t) => t.docId))]
    const outDocs = outDocIds.length ? await this.docs.find({ where: { id: In(outDocIds) } }) : []
    const consumedBy = outTxns
      .filter((t) => t.direction === 'out')
      .map((t) => {
        const d = outDocs.find((x) => x.id === t.docId)
        return {
          docNo: d?.docNo ?? t.docId,
          docType: t.txnType,
          outM: Math.abs(Number(t.changeQuantity)),
          partnerName: d?.partnerName ?? null,
          date: d?.createdAt ?? t.createdAt,
        }
      })

    return {
      batch: {
        id: batch.id,
        batchNo: batch.batchNo,
        materialId: batch.materialId,
        quantity: batch.quantity,
        remaining: batch.remainingQuantity,
        weightKg: batch.weightKg,
        areaM2: batch.areaM2,
        sourceType: batch.sourceType,
        status: batch.status,
        inboundAt: batch.inboundAt,
      },
      spec: await this.specBrief(batch.specId),
      origin: await this.traceOrigin(batch, new Set<string>()),
      consumedBy,
    }
  }
}
