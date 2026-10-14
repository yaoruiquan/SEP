import 'reflect-metadata';
import { INestApplication, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { resolve } from 'node:path';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { SessionService } from '../src/modules/auth/session.service';
import { ClientEmploymentGuard } from '../src/modules/client/client-employment.guard';
import { GatewayAuthRateLimitService } from '../src/modules/gateway/gateway-auth-rate-limit.service';
import { MediaGatewayMockAdapter } from '../src/modules/media-gateway/media-gateway-mock.adapter';
import { MediaGatewayMockGuard } from '../src/modules/media-gateway/media-gateway-mock.guard';
import { MediaGatewayController } from '../src/modules/media-gateway/media-gateway.controller';
import { MediaGatewayService } from '../src/modules/media-gateway/media-gateway.service';
import { MediaGatewayStore } from '../src/modules/media-gateway/media-gateway.store';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';

class LocalConfigurationError extends Error {}

function settings(environment: Record<string, string | undefined>) {
  if (!['development', 'test'].includes(environment.NODE_ENV ?? '') ||
      environment.MEDIA_GATEWAY_MOCK_ENABLED !== 'true') {
    throw new LocalConfigurationError('Requires NODE_ENV=development or test and MEDIA_GATEWAY_MOCK_ENABLED=true');
  }
  const databaseUrl = environment.MEDIA_GATEWAY_TEST_DATABASE_URL;
  if (!databaseUrl || !environment.DATABASE_URL) {
    throw new LocalConfigurationError('Explicit MEDIA_GATEWAY_TEST_DATABASE_URL and business DATABASE_URL are required');
  }
  let media: URL;
  let business: URL;
  try {
    media = new URL(databaseUrl);
    business = new URL(environment.DATABASE_URL);
  } catch {
    throw new LocalConfigurationError('Database configuration must contain valid PostgreSQL URLs');
  }
  if (!['postgres:', 'postgresql:'].includes(media.protocol) ||
      !['postgres:', 'postgresql:'].includes(business.protocol) ||
      !['localhost', '127.0.0.1', '[::1]'].includes(media.hostname) ||
      !/^\/sep_media_mock_[a-z0-9_]+$/.test(media.pathname) ||
      [...media.searchParams.keys()].some((key) => key.toLowerCase() === 'host')) {
    throw new LocalConfigurationError('Media storage must target a loopback sep_media_mock_* database without a host override');
  }
  let businessDatabase: string;
  try {
    businessDatabase = decodeURIComponent(business.pathname);
  } catch {
    throw new LocalConfigurationError('Business database name must be valid');
  }
  // Reject the same database even when credentials, loopback aliases or query options differ.
  if (media.pathname === businessDatabase) {
    throw new LocalConfigurationError('Media storage must not target the business database');
  }
  const rawPort = environment.MEDIA_GATEWAY_MOCK_PORT ?? '3002';
  const port = /^\d+$/.test(rawPort) ? Number(rawPort) : NaN;
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535 ||
      port === 3001 || port === Number(environment.PORT)) {
    throw new LocalConfigurationError('MEDIA_GATEWAY_MOCK_PORT must be a separate TCP port between 1 and 65535, not the auth port');
  }
  if (!(environment.ACCESS_JWT_SECRET ?? environment.JWT_SECRET)?.trim()) {
    throw new LocalConfigurationError('Existing employment JWT verification secret is required');
  }
  return { databaseUrl, port };
}

const MEDIA_MOCK_PRISMA = Symbol('MEDIA_MOCK_PRISMA');
let moduleRef: TestingModule | undefined;
let app: INestApplication | undefined;
let mediaPrisma: PrismaClient | undefined;
let closing: Promise<void> | undefined;
let stopping = false;

function close(): Promise<void> {
  closing ??= (async () => {
    try {
      if (app) await app.close();
      else await moduleRef?.close();
    } finally {
      await mediaPrisma?.$disconnect();
    }
  })();
  return closing;
}

async function bootstrap() {
  // Suppress dependency error logs: connection failures can otherwise expose DSNs.
  Logger.overrideLogger(false);
  let local: ReturnType<typeof settings>;
  const configModule = await ConfigModule.forRoot({
    isGlobal: true,
    envFilePath: resolve(__dirname, '../.env'),
    validate: (environment) => {
      local = settings(environment);
      return environment;
    },
  });
  moduleRef = await Test.createTestingModule({
    imports: [configModule],
    controllers: [MediaGatewayController],
    providers: [
      JwtService, RedisService, GatewayAuthRateLimitService, ClientEmploymentGuard,
      MediaGatewayMockGuard, MediaGatewayMockAdapter, MediaGatewayService,
      {
        provide: PrismaService,
        inject: [ConfigService],
        useFactory: (config: ConfigService) => new PrismaService({
          datasources: { db: { url: config.getOrThrow<string>('DATABASE_URL') } }, log: [],
        }),
      },
      {
        provide: SessionService,
        inject: [PrismaService, ConfigService],
        useFactory: (prisma: PrismaService, config: ConfigService) => new SessionService(prisma, config),
      },
      {
        provide: MEDIA_MOCK_PRISMA,
        useFactory: () => {
          mediaPrisma = new PrismaClient({ datasources: { db: { url: local.databaseUrl } }, log: [] });
          return mediaPrisma;
        },
      },
      {
        provide: MediaGatewayStore,
        inject: [MEDIA_MOCK_PRISMA],
        useFactory: (prisma: PrismaClient) => new MediaGatewayStore(prisma as PrismaService),
      },
    ],
  }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.init();
  await mediaPrisma.$connect();
  await app.get(RedisService).redis.ping();
  if (stopping) return;
  await app.listen(local.port, '127.0.0.1');
  if (!stopping) {
    console.log(`MEDIA_ELECTRON_MOCK_READY http://127.0.0.1:${local.port}/api/gateway/v1/media`);
  }
}

async function shutdown() {
  if (stopping) return;
  stopping = true;
  try {
    await startup;
  } catch {
    // Startup failures are reported separately without dependency error details.
  }
  try {
    await close();
    console.log('MEDIA_ELECTRON_MOCK_STOPPED');
  } catch {
    console.error('MEDIA_ELECTRON_MOCK_CLOSE_FAILED (details suppressed)');
    process.exitCode = 1;
  }
}

process.once('SIGINT', () => { void shutdown(); });
process.once('SIGTERM', () => { void shutdown(); });
const startup = bootstrap();
void startup.catch(async (error: unknown) => {
  console.error(error instanceof LocalConfigurationError
    ? `MEDIA_ELECTRON_MOCK_CONFIG_ERROR: ${error.message}`
    : 'MEDIA_ELECTRON_MOCK_START_FAILED (details suppressed)');
  process.exitCode = 1;
  try {
    await close();
  } catch {
    console.error('MEDIA_ELECTRON_MOCK_CLOSE_FAILED (details suppressed)');
  }
});
