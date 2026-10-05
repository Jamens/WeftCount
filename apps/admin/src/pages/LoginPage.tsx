import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Button, Card, Form, Input, Space, Tag, Typography } from 'antd'
import { UserOutlined, LockOutlined, LoginOutlined } from '@ant-design/icons'
import { useAuthStore } from '../stores/auth.store'

const { Title, Text, Paragraph } = Typography

interface LoginForm {
  username: string
  password: string
}

/** 演示账号，部署到生产环境时应移除 */
const DEMO_ACCOUNTS = [
  { username: 'owner', label: '集团管理员', desc: '全部权限' },
  { username: 'factory', label: '厂长', desc: '单公司全权' },
  { username: 'craft', label: '工艺员', desc: '仅系数与用料' },
  { username: 'warehouse', label: '仓管员', desc: '仅库存' },
  { username: 'loom', label: '挡车工', desc: '仅报工' },
]

export default function LoginPage() {
  const navigate = useNavigate()
  const [form] = Form.useForm<LoginForm>()
  const login = useAuthStore((s) => s.login)
  const loading = useAuthStore((s) => s.loading)
  const error = useAuthStore((s) => s.error)
  const [showDemo, setShowDemo] = useState(true)

  const onFinish = async (values: LoginForm) => {
    const ok = await login(values.username, values.password)
    if (ok) navigate('/', { replace: true })
  }

  const fillDemo = (username: string) => {
    form.setFieldsValue({ username, password: 'weft2026' })
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div style={{ width: 420, maxWidth: '100%' }}>
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <div style={{ textAlign: 'center' }}>
            <Title level={2} style={{ marginBottom: 4 }}>
              纬数 WeftCount
            </Title>
            <Text type="secondary">纺织行业 AI 进销存系统</Text>
          </div>

          <Card size="small">
            {error && (
              <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />
            )}
            <Form<LoginForm>
              form={form}
              layout="vertical"
              size="large"
              onFinish={onFinish}
              initialValues={{ username: 'factory', password: 'weft2026' }}
            >
              <Form.Item
                name="username"
                label="账号"
                rules={[{ required: true, message: '请输入账号' }]}
              >
                <Input prefix={<UserOutlined />} placeholder="账号" autoComplete="username" />
              </Form.Item>

              <Form.Item
                name="password"
                label="密码"
                rules={[{ required: true, message: '请输入密码' }]}
              >
                <Input.Password
                  prefix={<LockOutlined />}
                  placeholder="密码"
                  autoComplete="current-password"
                  onPressEnter={() => form.submit()}
                />
              </Form.Item>

              <Button
                type="primary"
                htmlType="submit"
                block
                loading={loading}
                icon={<LoginOutlined />}
              >
                登录
              </Button>
            </Form>
          </Card>

          <Card
            size="small"
            title={
              <Space>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  演示账号（密码 weft2026）
                </Text>
                <Text
                  style={{ fontSize: 12, cursor: 'pointer', color: '#1D9E75' }}
                  onClick={() => setShowDemo((v) => !v)}
                >
                  {showDemo ? '收起' : '展开'}
                </Text>
              </Space>
            }
          >
            {showDemo && (
              <Space direction="vertical" size={6} style={{ width: '100%' }}>
                {DEMO_ACCOUNTS.map((a) => (
                  <div
                    key={a.username}
                    onClick={() => fillDemo(a.username)}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '6px 8px',
                      borderRadius: 6,
                      cursor: 'pointer',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(29,158,117,0.1)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent'
                    }}
                  >
                    <Space size={8}>
                      <Text code>{a.username}</Text>
                      <Text style={{ fontSize: 12 }}>{a.label}</Text>
                    </Space>
                    <Tag style={{ fontSize: 11 }}>{a.desc}</Tag>
                  </div>
                ))}
              </Space>
            )}
          </Card>

          <Paragraph type="secondary" style={{ fontSize: 12, textAlign: 'center', marginBottom: 0 }}>
            部署到生产环境前请删除演示账号并修改默认密码
          </Paragraph>
        </Space>
      </div>
    </div>
  )
}
