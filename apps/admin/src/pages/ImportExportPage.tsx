import { useState } from 'react'
import { App as AntdApp, Alert, Button, Card, Radio, Space, Statistic, Table, Tag, Typography, Upload } from 'antd'
import { DownloadOutlined, InboxOutlined } from '@ant-design/icons'
import { api, tokenStore, contextStore } from '../lib/api'
import { PERM } from '../lib/erp'
import { useAuthStore } from '../stores/auth.store'

const { Title, Text } = Typography

interface ImportResult {
  total: number
  succeeded: number
  failed: number
  errors: { row: number; message: string }[]
}

/** 带鉴权头下载（模板/导出走后端，需 Authorization，不能用裸 <a download>） */
async function authDownload(url: string, filename: string) {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${tokenStore.get()}`,
      'X-Tenant-Id': contextStore.getTenantId() ?? '',
      'X-Company-Id': contextStore.getCompanyId() ?? '',
    },
  })
  if (!res.ok) throw new Error(`下载失败(${res.status})`)
  const blob = await res.blob()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

/** 导入导出中心：物料/规格 CSV 批量导入 + 物料 XLSX 导出 */
export default function ImportExportPage() {
  const { message } = AntdApp.useApp()
  const canEdit = useAuthStore((s) => s.hasPermission(PERM.MATERIAL_EDIT))
  const [kind, setKind] = useState<'materials' | 'specs'>('materials')
  const [csv, setCsv] = useState<string>('')
  const [fileName, setFileName] = useState<string>('')
  const [result, setResult] = useState<ImportResult | null>(null)
  const [busy, setBusy] = useState(false)

  const label = kind === 'materials' ? '物料' : '规格'

  const onFile = (f: File) => {
    setFileName(f.name)
    setResult(null)
    const reader = new FileReader()
    reader.onload = () => {
      setCsv(String(reader.result ?? ''))
      message.success(`已读取 ${f.name}`)
    }
    reader.readAsText(f)
  }

  const doImport = async () => {
    if (!csv) {
      message.warning('请先选择 CSV 文件')
      return
    }
    setBusy(true)
    try {
      const r = await api.post<ImportResult>(`/import-export/${kind}/import`, { csv })
      setResult(r.data.data)
      const { succeeded, failed } = r.data.data
      if (failed === 0) message.success(`全部导入成功：${succeeded} 条`)
      else message.warning(`部分成功：成功 ${succeeded}，失败 ${failed}`)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '导入失败')
    } finally {
      setBusy(false)
    }
  }

  const download = async (kind2: 'template' | 'export', k2: 'materials' | 'specs') => {
    try {
      const name = kind2 === 'template' ? `${k2}-template.csv` : `${k2}.xlsx`
      await authDownload(`/api/import-export/${k2}/${kind2}`, name)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '下载失败')
    }
  }

  return (
    <div>
      <Space align="center" style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <div>
          <Title level={4} style={{ margin: 0 }}><InboxOutlined /> 导入导出</Title>
          <Text type="secondary" style={{ fontSize: 12 }}>批量导入物料/规格（CSV），导出物料（XLSX）——逐行校验，失败不影响其他行</Text>
        </div>
      </Space>

      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Card size="small">
          <Space wrap>
            <Radio.Group value={kind} onChange={(e) => { setKind(e.target.value); setFileName(''); setCsv(''); setResult(null) }} optionType="button" buttonStyle="solid"
              options={[{ label: '物料', value: 'materials' }, { label: '规格', value: 'specs' }]} />
            <Button icon={<DownloadOutlined />} onClick={() => void download('template', kind)}>下载{label}模板(CSV)</Button>
            {kind === 'materials' && <Button icon={<DownloadOutlined />} onClick={() => void download('export', 'materials')}>导出物料(XLSX)</Button>}
          </Space>
        </Card>

        <Card size="small" title={`导入${label}`}>
          <Upload.Dragger
            accept=".csv,text/csv"
            maxCount={1}
            beforeUpload={(f) => { onFile(f); return false }}
            onRemove={() => { setFileName(''); setCsv(''); setResult(null) }}
            disabled={!canEdit}
          >
            <p style={{ margin: 0 }}>{fileName ? `已选择：${fileName}` : '点击或拖拽 CSV 文件到此处'}</p>
            <Text type="secondary" style={{ fontSize: 12 }}>请先下载模板，按列填写后导入（列名带 * 为必填）</Text>
          </Upload.Dragger>
          {canEdit && (
            <Button type="primary" block style={{ marginTop: 12 }} loading={busy} disabled={!csv} onClick={() => void doImport()}>
              开始导入
            </Button>
          )}
          {!canEdit && <Alert style={{ marginTop: 12 }} type="info" showIcon message="当前账号无导入权限（需 material.edit）" />}
        </Card>

        {result && (
          <Card size="small" title="导入结果">
            <Space size="large" style={{ marginBottom: 12 }}>
              <Statistic title="总行数" value={result.total} />
              <Statistic title="成功" value={result.succeeded} valueStyle={{ color: '#3f8600' }} />
              <Statistic title="失败" value={result.failed} valueStyle={{ color: result.failed ? '#cf1322' : undefined }} />
            </Space>
            {result.errors.length > 0 && (
              <Table
                rowKey={(r) => r.row}
                size="small"
                pagination={false}
                dataSource={result.errors}
                columns={[
                  { title: '行号', dataIndex: 'row', width: 80, render: (v: number) => <Tag>第 {v} 行</Tag> },
                  { title: '失败原因', dataIndex: 'message' },
                ]}
              />
            )}
          </Card>
        )}
      </Space>
    </div>
  )
}
