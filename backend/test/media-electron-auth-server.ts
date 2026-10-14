import 'reflect-metadata';
import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { resolve } from 'node:path';
import { validateAuthEnvironment } from '../src/auth-environment';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { basicRateLimitMiddleware } from '../src/common/middleware/basic-rate-limit.middleware';
import { createJsonBodyMiddleware } from '../src/common/middleware/json-body.middleware';
import { requestContextMiddleware } from '../src/common/middleware/request-context.middleware';
import { ClientModule } from '../src/modules/client/client.module';
import { SecurityModule } from '../src/modules/security/security.module';
import { RedisModule } from '../src/redis/redis.module';
import { validateMediaElectronReviewConfig } from './helpers/media-electron-review-config';

let moduleRef: TestingModule | undefined;
let app: INestApplication | undefined;
let closing: Promise<void> | undefined;
let stopping = false;

function close(): Promise<void> {
  closing ??= (async () => {
    if (app) await app.close();
    else await moduleRef?.close();
  })();
  return closing;
}

async function bootstrap() {
  // This runner uses real client/auth modules without loading task workers or model execution.
  Logger.overrideLogger(false);
  if (!['development', 'test'].includes(process.env.NODE_ENV ?? '') ||
      process.env.SEP_ELECTRON_MEDIA_MOCK !== 'true' || process.env.E2E_TEST === '1') {
    throw new Error('Explicit local mock configuration required');
  }
  const rawPort = process.env.MEDIA_ELECTRON_AUTH_PORT ?? '3001';
  const port = /^\d+$/.test(rawPort) ? Number(rawPort) : NaN;
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535 || port === 3002) {
    throw new Error('Separate local auth port required');
  }
  const configModule = await ConfigModule.forRoot({
    isGlobal: true,
    envFilePath: resolve(__dirname, '../.env'),
    validate: (environment) => {
      validateMediaElectronReviewConfig(environment);
      return validateAuthEnvironment(environment);
    },
  });
  moduleRef = await Test.createTestingModule({
    imports: [configModule, RedisModule, SecurityModule, ClientModule],
  }).compile();
  app = moduleRef.createNestApplication({ logger: false, bodyParser: false });
  app.setGlobalPrefix('api');
  app.use(requestContextMiddleware, basicRateLimitMiddleware);
  app.use(createJsonBodyMiddleware());
  app.use(cookieParser());
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  await app.init();
  if (stopping) return;
  await app.listen(port, '127.0.0.1');
  if (!stopping) console.log(`MEDIA_ELECTRON_AUTH_READY http://127.0.0.1:${port}/api`);
}

async function shutdown() {
  if (stopping) return;
  stopping = true;
  try { await startup; } catch { /* Startup errors are reported separately. */ }
  try {
    await close();
    console.log('MEDIA_ELECTRON_AUTH_STOPPED');
  } catch {
    console.error('MEDIA_ELECTRON_AUTH_CLOSE_FAILED (details suppressed)');
    process.exitCode = 1;
  }
}

process.once('SIGINT', () => { void shutdown(); });
process.once('SIGTERM', () => { void shutdown(); });
const startup = bootstrap();
void startup.catch(async () => {
  console.error('MEDIA_ELECTRON_AUTH_START_FAILED (details suppressed)');
  process.exitCode = 1;
  try { await close(); } catch { console.error('MEDIA_ELECTRON_AUTH_CLOSE_FAILED (details suppressed)'); }
});
