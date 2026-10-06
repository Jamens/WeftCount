import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { ValidationPipe, Logger } from '@nestjs/common'
import { NestExpressApplication } from '@nestjs/platform-express'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { AppModule } from './app.module'
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter'
import { ResponseInterceptor } from './common/interceptors/response.interceptor'

const PORT = Number(process.env.PORT ?? 3180)

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['error', 'warn', 'log'],
  })

  app.setGlobalPrefix('api', { exclude: [] })

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

  app.enableCors({
    origin: true,
    credentials: true,
  })

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

  const config = new DocumentBuilder()
    .setTitle('纬数 WeftCount API')
    .setDescription('纺织行业 AI 进销存系统 · 后端服务')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build()
  const document = SwaggerModule.createDocument(app, config)
  SwaggerModule.setup('api/docs', app, document)

  await app.listen(PORT, '0.0.0.0')
  new Logger('Bootstrap').log(`纬数服务已启动: http://127.0.0.1:${PORT}/api`)
  new Logger('Bootstrap').log(`API 文档: http://127.0.0.1:${PORT}/api/docs`)
}

void bootstrap()
