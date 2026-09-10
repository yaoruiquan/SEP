import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { WsAdapter } from '@nestjs/platform-ws';
import cookieParser from 'cookie-parser';
import express from 'express';
import { AppModule } from './app.module';
import { requestContextMiddleware } from './common/middleware/request-context.middleware';
import { basicRateLimitMiddleware } from './common/middleware/basic-rate-limit.middleware';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use(requestContextMiddleware, basicRateLimitMiddleware);
  app.use(express.json({ limit: process.env.REQUEST_JSON_LIMIT || '2mb' }));
  app.use(express.urlencoded({ limit: process.env.REQUEST_URLENCODED_LIMIT || '2mb', extended: true }));
  app.useGlobalFilters(new HttpExceptionFilter());
  app.use((req, res, next) => {
    const started = Date.now();
    res.on('finish', () => Logger.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - started}ms`, 'HTTP'));
    next();
  });

  // WebSocket adapter
  app.useWebSocketAdapter(new WsAdapter(app));

  // Cookie parser (required for refresh token cookie)
  app.use(cookieParser());

  // Enable CORS
  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3000', 'http://localhost:4173'],
    credentials: true,
  });

  // Global API prefix
  app.setGlobalPrefix('api');

  app.getHttpAdapter().get('/health', (_req, res) => res.status(200).json({ status: 'ok', service: 'sep-backend', timestamp: new Date().toISOString() }));

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Swagger documentation
  const config = new DocumentBuilder()
    .setTitle('Silicon Talent Platform API')
    .setDescription('硅基人才平台 API 文档')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  const port = process.env.PORT || 3001;
  await app.listen(port);

  console.log(`🚀 Platform API is running on: http://localhost:${port}`);
  console.log(`📚 API Documentation: http://localhost:${port}/api/docs`);
}

bootstrap();
