import type { EntityTarget } from 'typeorm'
import { AUDIT_TARGET_TYPES } from '@weftcount/shared'
import { MaterialEntity } from '../material/entities/material.entity'
import { GreigeSpecEntity } from '../material/entities/greige-spec.entity'
import { PartnerEntity } from '../partner/entities/partner.entity'
import { WarehouseEntity } from '../warehouse/entities/warehouse.entity'
import { TradeOrderEntity } from '../order/entities/trade-order.entity'
import { ContractEntity } from '../contract/entities/contract.entity'
import { MachineEntity } from '../production/entities/machine.entity'
import { ProductionOrderEntity } from '../production/entities/production-order.entity'
import { InventoryDocumentEntity } from '../inventory/entities/inventory-document.entity'
import { StocktakeEntity } from '../stocktake/entities/stocktake.entity'
import { InspectionEntity } from '../quality/entities/inspection.entity'

/**
 * 审计目标类型 → 实体类
 *
 * ## 为什么是「一张集中注册表」，而不是让各 service 自己上报 before快照
 *
 * 最直觉的做法是给每个 service 的 update 方法注入 `AuditService`，
 * 改之前调`audit.snapshot(entity)` 抓原值。实测下来这条路走不通：
 *
 * - **模块循环**：`inventory.module` 已经 imports `MaterialModule`，
 *   若 `MaterialModule` 为了审计再 imports `AuditModule`，
 *   而 `AuditModule` 若也需要实体仓库，就是一条闭环。
 * - **改 6 处、漏 1 处就静默失效**：漏掉的那处 before 恒为 null，
 *   审计页照常显示「已修改」，只是 before 列全null——**没有任何报错提示**。
 *   这种「看起来正常、实际失效」的缺陷比崩溃更难发现。
 *
 * 拦截器方案的好处：
 * - 业务 service **零改动**，不存在漏接线的可能
 * - 新增受审计实体只需往这张表加一行
 * - 实体快照在**库里的真实状态**，而不是各 service 自报的字段子集
 *
 * ## 代价
 *
 * 每次写操作多 1~2 次主键查询。只对注册表内的targetType 生效，
 * 且注册表目前 10 项，覆盖了所有会改状态的主数据（物料/规格/往来单位/仓库/
 * 订单/合同/机台/工单/库存单据/盘点单）。
 *
 * ## 约束
 *
 * 注册的实体必须有 `id` 与 `tenantId` 字段——按 tenantId 复核是租户隔离的底线，
 * 漏了这个条件就是跨租户数据泄露。
 */
export const AUDIT_TARGET_ENTITIES: Record<string, EntityTarget<never>> = {
  material: MaterialEntity as unknown as EntityTarget<never>,
  greige_spec: GreigeSpecEntity as unknown as EntityTarget<never>,
  partner: PartnerEntity as unknown as EntityTarget<never>,
  warehouse: WarehouseEntity as unknown as EntityTarget<never>,
  order: TradeOrderEntity as unknown as EntityTarget<never>,
  contract: ContractEntity as unknown as EntityTarget<never>,
  machine: MachineEntity as unknown as EntityTarget<never>,
  production_order: ProductionOrderEntity as unknown as EntityTarget<never>,
  inventory_document: InventoryDocumentEntity as unknown as EntityTarget<never>,
  stocktake: StocktakeEntity as unknown as EntityTarget<never>,
  inspection: InspectionEntity as unknown as EntityTarget<never>,
}

/**
 * 与 `AUDIT_TARGET_TYPES`（shared 单一事实源）的双向一致性自检
 *
 * 这份注册表和 shared 清单曾经各写一份，结果前端下拉里的
 * `inventory_batch` 后端从不写、`machine` / `inventory_document` 前端又没有。
 * 两边手改必然再次漂移，所以在模块加载时就把差异暴露出来——
 * **启动即失败，远好过用户选了筛选项查不到记录却不知道原因**。
 */
const registered = Object.keys(AUDIT_TARGET_ENTITIES).sort()
const declared: string[] = [...AUDIT_TARGET_TYPES].sort()
if (registered.join(',') !== declared.join(',')) {
  throw new Error(
    `审计目标类型与 shared 不一致。\n` +
      `  已注册实体: ${registered.join(', ') || '(空)'}\n` +
      `  shared 声明: ${declared.join(', ') || '(空)'}\n` +
      `  仅实体侧多出: ${registered.filter((k) => !declared.includes(k)).join(', ') || '无'}\n` +
      `  仅shared 多出: ${declared.filter((k) => !registered.includes(k)).join(', ') || '无'}`,
  )
}

/**
 * 会产生字段级before/after 的动作
 *
 * `create` 不在其列：新建前实体不存在，before 天然为 null，
 * 走请求体快照即可（`after` 语义相同）。
 */
export const SNAPSHOT_ACTIONS = new Set(['update', 'delete', 'submit', 'approve', 'reject', 'cancel'])
