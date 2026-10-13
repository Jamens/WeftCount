import { useCallback, useEffect, useState } from 'react'
import { App as AntdApp, Button, Card, Empty, Input, Select, Space, Table, Tag, Timeline, Typography } from 'antd'
import { HistoryOutlined, ReloadOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { AUDIT_TARGET_TYPES, type AuditActionType } from '@weftcount/shared'
import { api } from '../lib/api'
import { TARGET_LABELS, displayValue, fieldLabel, targetLabel } from '../lib/audit-labels'
import { ACTION_LABELS } from './AuditLogPage'

const { Text } = Typography

/** 与后端 audit/target 返回一致的审计记录（字段与 AuditRecord 相同） */
interface AuditRecord {
  id: string
  username: string
  realName: string
  action: AuditActionType
  module: string
  summary: string | null
  targetType: string | null
  targetId: string | null
  diff: Record<string, { before: unknown; after: unknown }> | null
  createdAt: string
}

/**
 * 对象类型的中文名与可选值统一来自 `@weftcount/shared` 的 `AUDIT_TARGET_TYPES`
 * ——后端写入的 targetType 也以它为唯一清单（见服务端 `audit-targets.ts` 的加载期自检）。
 *
 * 之前这里手写了一份，混进了后端从不写的 `inventory_batch` / `roll`（其中前者还是默认值，
 * 不重置筛选就查不到任何记录），漏掉了实际会写的 `machine` / `inventory_document`。
 */

/**
 * 对象操作时间线
 *
 * 「某批次/件卡/订单到底被谁改过、什么时候改的」——审计日志原本只能按时间倒序翻，
 * 找特定对象要一页页翻。这里按 `targetType+targetId` 拉出该对象的**完整变更史**，
 * 按时间正序展示，并标出每个字段的前后值（diff）。
 *
 * 后端 `GET /audit-logs/target` 早就提供了这个能力，只是界面没接。
 */
export default function AuditTimeline() {
  const { message } = AntdApp.useApp()
  const [targetType, setTargetType] = useState<string>(AUDIT_TARGET_TYPES[0])
  const [targetId, setTargetId] = useState<string>('')
  const [records, setRecords] = useState<AuditRecord[] | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    const id = targetId.trim()
    if (!id) {
      message.warning('请输入对象 ID')
      return
    }
    setLoading(true)
    try {
      const res = await api.get<{ records: AuditRecord[] }>(
        `/audit-logs/target?targetType=${encodeURIComponent(targetType)}&targetId=${encodeURIComponent(id)}`,
      )
      const rows = res.data.data.records
      setRecords(rows)
      if (rows.length === 0) message.info('该对象暂无操作记录')
    } catch (e) {
      message.error(e instanceof Error ? e.message : '查询失败')
    } finally {
      setLoading(false)
    }
  }, [targetType, targetId, message])

  // 目标类型或 ID 变化时清空旧结果，避免张冠李戴
  useEffect(() => {
    setRecords(null)
  }, [targetType, targetId])

  return (
    <Card
      size="small"
      title={
        <Space>
          <HistoryOutlined />
          <span>对象操作时间线</span>
        </Space>
      }
      extra={
        <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>
          查询
        </Button>
      }
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Space wrap>
          <Text type="secondary">对象类型</Text>
          <Select
            style={{ width: 180 }}
            value={targetType}
            onChange={setTargetType}
            options={AUDIT_TARGET_TYPES.map((v) => ({ value: v, label: TARGET_LABELS[v] ?? v }))}
          />
          <Text type="secondary">对象 ID</Text>
          <Input
            style={{ width: 320 }}
            value={targetId}
            onChange={(e) => setTargetId(e.target.value.trim())}
            placeholder="对象 ID（可从各详情页复制）"
            onPressEnter={() => void load()}
          />
        </Space>

        {records == null ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="输入对象类型与 ID 后查询其完整变更史" />
        ) : records.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该对象暂无操作记录" />
        ) : (
          <>
            <Text type="secondary" style={{ fontSize: 12 }}>
              共 {records.length} 条记录（按时间正序）
            </Text>
            <Timeline
              items={[...records]
                .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
                .map((r) => ({
                  color: ACTION_LABELS[r.action]?.color ?? 'gray',
                  children: (
                    <div>
                      <Space size={6} wrap>
                        <Tag color={ACTION_LABELS[r.action]?.color ?? 'default'}>
                          {ACTION_LABELS[r.action]?.text ?? r.action}
                        </Tag>
                        <Text strong>{r.realName || r.username}</Text>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {targetLabel(r.targetType)} · {dayjs(r.createdAt).format('YYYY-MM-DD HH:mm:ss')}
                        </Text>
                      </Space>
                      {r.summary && (
                        <div style={{ marginTop: 4 }}>
                          <Text style={{ fontSize: 13 }}>{r.summary}</Text>
                        </div>
                      )}
                      {r.diff && Object.keys(r.diff).length > 0 && (
                        <Table
                          rowKey="field"
                          size="small"
                          pagination={false}
                          style={{ marginTop: 6, maxWidth: 640 }}
                          dataSource={Object.entries(r.diff).map(([field, d]) => ({
                            field,
                            label: fieldLabel(field),
                            before: displayValue(d.before),
                            after: displayValue(d.after),
                          }))}
                          columns={[
                            { title: '字段', dataIndex: 'label', width: 140 },
                            { title: '变更前', dataIndex: 'before', ellipsis: true },
                            { title: '变更后', dataIndex: 'after', ellipsis: true },
                          ]}
                        />
                      )}
                    </div>
                  ),
                }))}
            />
          </>
        )}
      </Space>
    </Card>
  )
}