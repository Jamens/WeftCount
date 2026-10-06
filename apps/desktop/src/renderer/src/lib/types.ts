/** 车间工作台用的线类型（后端 decimal 序列化为字符串，展示前用 num 解析） */

export interface MachineWire {
  id: string
  code: string
  name: string
  model: string | null
  status: 'idle' | 'running' | 'maintenance' | 'retired'
}

export interface ProductionOrderWire {
  id: string
  orderNo: string
  specId: string
  plannedQuantityM: string
  producedQuantityM: string
  machineId: string | null
  status: 'draft' | 'scheduled' | 'in_progress' | 'completed' | 'cancelled'
  dueDate: string | null
}

export interface GreigeSpecWire {
  id: string
  code: string
  name: string
}

/** 可报工工单（服务端已带机台名/规格名，挡车工单请求即可渲染） */
export interface ReportableOrder {
  id: string
  orderNo: string
  specId: string
  specName: string | null
  machineId: string | null
  machineName: string | null
  plannedQuantityM: string
  producedQuantityM: string
  status: 'scheduled' | 'in_progress'
  dueDate: string | null
}

export interface WarehouseWire {
  id: string
  code: string
  name: string
}

export interface MaterialWire {
  id: string
  code: string
  name: string
}

export interface PartnerWire {
  id: string
  code: string
  name: string
  type: 'supplier' | 'customer' | 'both'
  status: 'active' | 'disabled'
}

export interface BatchWire {
  id: string
  batchNo: string
  materialId: string
  specId: string
  warehouseId: string | null
  quantity: string
  remainingQuantity: string
  weightKg: string
  areaM2: string
  status: string
  inboundAt: string
}

/** 批次来源链（简化，用于扫码查询页展示） */
export type BatchOrigin =
  | { kind: 'production'; workOrder: { orderNo: string; status: string }; machine: { name: string; model: string | null } | null; report: { reportDate: string; outputM: string } }
  | { kind: 'purchase'; purchaseDoc: { docNo: string }; supplier: { name: string } | null; purchaseOrder: { orderNo: string } | null }
  | { kind: 'transfer'; fromBatchNo: string; origin: BatchOrigin | null }
  | { kind: 'unknown'; sourceType: string }

export interface BatchTrace {
  batch: BatchWire & { sourceType: string }
  spec: { code: string; name: string; totalGsm: number } | null
  origin: BatchOrigin | null
  consumedBy: Array<{ docNo: string; docType: string; outM: number; partnerName: string | null }>
}

/** decimal 字符串 → number */
export function num(v: string | number | null | undefined): number {
  if (v == null || v === '') return 0
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

export function fmt(v: string | number | null | undefined, scale = 1): string {
  return num(v).toFixed(scale)
}
