import { useState } from 'react'
import { App as AntdApp, Button, Card, Form, Input, Typography } from 'antd'
import { UserOutlined, LockOutlined, LoginOutlined } from '@ant-design/icons'
import { api, authStore } from '../lib/api'

const { Title, Text } = Typography

interface LoginForm {
  username: string
  password: string
}

export default function LoginPage({ onSuccess }: { onSuccess: () => void }) {
  const { message } = AntdApp.useApp()
  const [loading, setLoading] = useState(false)
  const [form] = Form.useForm<LoginForm>()

  const onLogin = async () => {
    const v = await form.validateFields()
    setLoading(true)
    try {
      const data = await api.post<{ accessToken: string; tenant: { id: string }; currentCompanyId: string }>(
        '/auth/login',
        v,
      )
      authStore.setSession(data.accessToken, data.tenant.id, data.currentCompanyId)
      message.success('登录成功')
      onSuccess()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '登录失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f5f5' }}>
      <Card style={{ width: 360 }} variant="outlined">
        <Title level={4} style={{ textAlign: 'center' }}>
          纬数 · 车间工作台
        </Title>
        <Text type="secondary" style={{ display: 'block', textAlign: 'center', marginBottom: 20, fontSize: 12 }}>
          挡车工 / 仓管 日常操作台
        </Text>
        <Form<LoginForm> form={form} layout="vertical" onFinish={() => void onLogin()}>
          <Form.Item name="username" rules={[{ required: true, message: '请输入账号' }]}>
            <Input prefix={<UserOutlined />} placeholder="账号" size="large" autoFocus />
          </Form.Item>
          <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="密码" size="large" onPressEnter={() => void onLogin()} />
          </Form.Item>
          <Button type="primary" size="large" block icon={<LoginOutlined />} loading={loading} onClick={() => void onLogin()}>
            登录
          </Button>
        </Form>
        <Text type="secondary" style={{ display: 'block', textAlign: 'center', marginTop: 12, fontSize: 11 }}>
          需后端服务已启动（本机 3180）
        </Text>
      </Card>
    </div>
  )
}
