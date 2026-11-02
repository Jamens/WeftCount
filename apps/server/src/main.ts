import 'reflect-metadata'
import './config/security-env'
import { NestFactory } from '@nestjs/core'
import { ValidationPipe, Logger } from '@nestjs/common'
import { NestExpressApplication } from '@nestjs/platform-express'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import helmet from 'helmet'
import { AppModule } from './app.module'
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter'
import { ResponseInterceptor } from './common/interceptors/response.interceptor'
import { securityEnv } from './config/security-env'
import { createSwaggerBasicAuth } from './config/swagger-basic-auth'

const PORT = Number(process.env.PORT ?? 3180)

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['error', 'warn', 'log'],
  })
  const logger = new Logger('Bootstrap')

  app.setGlobalPrefix('api', { exclude: [] })

  /**
   * 反向代理信任跳数。限速要按**真实客户端 IP** 计数，
   * 前提是 Express 能从 X-Forwarded-For 里剥掉代理那一层。
   * 默认 1 跳，对应「nginx → server」的部署拓扑。
   */
  app.set('trust proxy', securityEnv.trustProxy)

  /**
   * 安全响应头。
   *
   * CSP 取 helmet 默认集合，只做两处微调：
   * - style-src 放开 'unsafe-inline'：Swagger UI 的 HTML 模板带内联 <style>
   * - script-src 保持 'self'：Swagger 的脚本全是外链
   *   （swagger-ui-bundle.js / swagger-ui-init.js），不需要放开内联脚本
   */
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          styleSrc: ["'self'", "'unsafe-inline'"],
          fontSrc: ["'self'", 'data:'],
          // 开发走 http，upgrade-insecure-requests 会把同源资源升级成 https → 页面空白
          upgradeInsecureRequests: securityEnv.isProduction ? [] : null,
        },
      },
      // HSTS 一旦下发浏览器会记很久，只在生产开
      hsts: securityEnv.isProduction ? { maxAge: 15552000, includeSubDomains: true } : false,
      // COEP 要求所有跨源资源带 CORP 头，收益小、兼容成本高
      crossOriginEmbedderPolicy: false,
    }),
  )

  /**
   * 桌面端(Electron)渲染进程请求本机 API 时，Chromium 会走 Private Network Access：
   * 预检带 `Access-Control-Request-Private-Network`，服务端必须回
   * `Access-Control-Allow-Private-Network: true`，否则请求被浏览器判违规拦掉，
   * 渲染进程只看到「网络错误」。这里统一给所有响应补上该头（含 OPTIONS 预检）。
   */
  app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Private-Network', 'true')
    next()
  })

  /**
   * CORS 白名单。
   *
   * 以前是 `origin: true`（放行任意来源），只要服务暴露出去，
   * 任何网页都能带着用户 cookie 调我们的接口。
   *
   * 现在按 CORS_ORIGIN 精确放行；生产未配置 = 拒绝一切跨源
   * （管理端与 API 是同源反代，本来就用不到 CORS）。
   */
  if (securityEnv.cors.allowAll) {
    logger.warn('CORS_ORIGIN=* —— 已放行任意来源跨域，仅可用于内网演示，生产请改成明确白名单')
    app.enableCors({ origin: true, credentials: true })
  } else if (securityEnv.cors.origins.length > 0) {
    logger.log(`CORS 白名单: ${securityEnv.cors.origins.join(', ')}`)
    app.enableCors({ origin: securityEnv.cors.origins, credentials: true })
  } else {
    logger.warn('未配置 CORS_ORIGIN，已拒绝一切跨源请求（管理端与 API 同源反代时无需 CORS）')
  }

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  )

  app.useGlobalFilters(new AllExceptionsFilter())
  app.useGlobalInterceptors(new ResponseInterceptor())

  /**
   * API 文档。
   *
   * 以前是无条件挂载的 —— 公网可达时等于给攻击者一份现成的攻击面地图
   * （全部路径、参数、字段一览无余）。现在：
   * - 生产默认**不注册** /api/docs（直接 404）
   * - SWAGGER_ENABLED=true 可开启
   * - 开启后若配了 SWAGGER_BASIC_AUTH_USER / _PASSWORD，文档页需 Basic Auth
   */
  if (securityEnv.swagger.enabled) {
    const config = new DocumentBuilder()
      .setTitle('纬数 WeftCount API')
      .setDescription('纺织行业 AI 进销存系统 · 后端服务')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build()
    const document = SwaggerModule.createDocument(app, config)

    const basicAuth = createSwaggerBasicAuth(securityEnv.swagger.user, securityEnv.swagger.password)
    if (basicAuth) {
      // 必须先于 SwaggerModule.setup 注册：Express 按注册顺序执行中间件
      app.use(['/api/docs', '/api/docs-json', '/api/docs-yaml'], basicAuth)
      logger.log('API 文档已启用 Basic Auth 保护')
    } else if (securityEnv.isProduction) {
      logger.warn('生产环境开启了 Swagger 文档但未配置 Basic Auth，文档将对所有可达者开放')
    }

    SwaggerModule.setup('api/docs', app, document)
    logger.log(`API 文档: http://127.0.0.1:${PORT}/api/docs`)
  } else {
    logger.warn('Swagger 文档已关闭（SWAGGER_ENABLED 未开启），/api/docs 返回 404')
  }

  await app.listen(PORT, '0.0.0.0')
  logger.log(`纬数服务已启动: http://127.0.0.1:${PORT}/api`)
}

void bootstrap()
