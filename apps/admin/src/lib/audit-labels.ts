import dayjs from 'dayjs'
import type { AuditTargetType } from '@weftcount/shared'

/**
 * 审计日志的展示字典
 *
 * 单独抽成文件是因为「对象操作时间线」与「审计日志列表」两处都要用：
 * 复制一份必然只改一处，然后两页对同一个值给出不同说法。
 */

/** 对象类型中文名，key 与 shared 的 AUDIT_TARGET_TYPES 一致 */
export const TARGET_LABELS: Record<AuditTargetType, string> = {
  material: '物料',
  greige_spec: '坯布规格',
  partner: '往来单位',
  warehouse: '仓库',
  order: '订单',
  contract: '合同',
  machine: '织机',
  production_order: '生产工单',
  inventory_document: '出入库单据',
  stocktake: '盘点单',
  inspection: '坯布检验',
}

/** 查不到就原样显示英文 key——空字符串会让用户以为没有值 */
export function targetLabel(v: string | null | undefined): string {
  if (!v) return '-'
  return TARGET_LABELS[v as AuditTargetType] ?? v
}

/**
 * 变更字段中文名
 *
 * 只覆盖审计 diff 里高频出现的字段。查不到就回退到原字段名——
 * 强行译成一个近似含义反而会误导（比如把 leadTimeDays 译成「采购周期」就丢了 lead time 的意思）。
 */
const FIELD_LABELS: Record<string, string> = {
  code: '编码',
  name: '名称',
  category: '类别',
  specification: '规格描述',
  measureMode: '计量方式',
  primaryUnit: '主单位',
  allowedUnits: '允许单位',
  batchManaged: '批次管理',
  safetyStock: '安全库存',
  leadTimeDays: '采购提前期(天)',
  status: '状态',
  remark: '备注',
  standardPrice: '标准单价',
  contactPerson: '联系人',
  contactPhone: '联系电话',
  address: '地址',
  taxNo: '税号',
  bankName: '开户行',
  bankAccount: '银行账号',
  isDefault: '默认',
  widthCm: '幅宽(cm)',
  weightPerMeter: '克重(g/m)',
  warpCount: '经密(根/cm)',
  weftCount: '纬密(根/cm)',
  loomType: '织机类型',
  dailyOutputM: '日产能(米)',
  materialId: '物料',
  specId: '规格',
  warehouseId: '仓库',
  quantity: '数量',
  unitPrice: '单价',
  totalAmount: '金额',
  orderId: '订单',
  dueDate: '交期',
  machineId: '织机',
  plannedMeters: '计划米数',
  actualMeters: '实际米数',
  operatorId: '挡车工',
  shift: '班次',
  stopReason: '停机原因',
}

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field
}

/**
 * 把变更值渲染成可读文本
 *
 * 直接 `JSON.stringify` 会把日期变成 `"2026-10-13T00:00:00.000Z"`、
 * null 变成 `"null"`（字符串）——用户分不清「空」和「字符串 null」。
 */
export function displayValue(v: unknown): string {
  if (v === null || v === undefined) return '（空）'
  if (typeof v === 'string') return v === '' ? '（空）' : v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (v instanceof Date) return dayjs(v).format('YYYY-MM-DD HH:mm:ss')
  if (Array.isArray(v)) return v.length === 0 ? '（空）' : v.map((x) => displayValue(x)).join('、')
  return JSON.stringify(v)
}
