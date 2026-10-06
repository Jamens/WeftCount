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

/** decimal 字符串 → number */
export function num(v: string | number | null | undefined): number {
  if (v == null || v === '') return 0
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

export function fmt(v: string | number | null | undefined, scale = 1): string {
  return num(v).toFixed(scale)
}
