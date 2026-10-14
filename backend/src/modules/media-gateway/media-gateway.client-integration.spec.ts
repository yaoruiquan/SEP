import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getOptionsToken } from '@nestjs/throttler';
import { PrismaClient } from '@prisma/client';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter';
import { PrismaService } from '../../prisma/prisma.service';
import { SessionService } from '../auth/session.service';
import { ClientEmploymentGuard } from '../client/client-employment.guard';
import { GatewayAuthRateLimitService } from '../gateway/gateway-auth-rate-limit.service';
import { SecurityModule } from '../security/security.module';
import { MediaGatewayController } from './media-gateway.controller';
import { MediaGatewayMockGuard } from './media-gateway-mock.guard';
import { MediaGatewayMockAdapter } from './media-gateway-mock.adapter';
import { MediaGatewayService } from './media-gateway.service';
import { MediaGatewayStore } from './media-gateway.store';

const databaseUrl = process.env.MEDIA_GATEWAY_TEST_DATABASE_URL;
const clientRoot = process.env.SEP_MEDIA_TEST_CLIENT_ROOT;
if (databaseUrl) {
  const url = new URL(databaseUrl);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !/^\/sep_media_mock_[a-z0-9_]+$/.test(url.pathname)) {
    throw new Error('Client integration requires a local sep_media_mock_* database');
  }
}
const integration = databaseUrl && clientRoot ? describe : describe.skip;

integration('SEP and desktop client HTTP / PostgreSQL mock integration', () => {
  let app: INestApplication | undefined;
  let database: PrismaClient;
  const enterpriseId = `media-integration-${randomUUID()}`;
  const subscriptionId = 'integration-subscription';
  const memberId = 'integration-member';
  const secret = randomUUID();
  const jwt = new JwtService();
  const token = jwt.sign({ sub: 'integration-user', sid: 'integration-session', enterpriseId, subscriptionId, memberId,
    type: 'client-employment' }, { secret, algorithm: 'HS256', expiresIn: 600 });
  const foreignToken = jwt.sign({ sub: 'integration-user', sid: 'integration-session', enterpriseId, subscriptionId,
    memberId: 'other-member', type: 'client-employment' }, { secret, algorithm: 'HS256', expiresIn: 600 });
  let submissions = 0;
  let sessionsChecked = 0;
  let clientActivity: Promise<string> | undefined;
  let stopClient: ((error: Error) => void) | undefined;

  async function start(port = 0) {
    const module = await Test.createTestingModule({
      imports: [SecurityModule], controllers: [MediaGatewayController],
      providers: [MediaGatewayService, MediaGatewayMockAdapter, MediaGatewayMockGuard, ClientEmploymentGuard,
        { provide: JwtService, useValue: jwt },
        { provide: ConfigService, useValue: { get: (key: string) => ({ NODE_ENV: 'test', MEDIA_GATEWAY_MOCK_ENABLED: 'true',
          ACCESS_JWT_SECRET: secret })[key] } },
        { provide: SessionService, useValue: { assertActiveSession: async () => { sessionsChecked++; } } },
        { provide: GatewayAuthRateLimitService, useValue: { consumeFailure: async () => ({ allowed: true }) } },
        { provide: PrismaService, useValue: { enterpriseMember: { findFirst: async () => ({ departmentId: null }) },
          subscription: { findFirst: async () => ({ id: subscriptionId }) } } },
        { provide: MediaGatewayStore, useValue: new MediaGatewayStore(database as unknown as PrismaService) },
      ],
    }).overrideProvider(getOptionsToken()).useValue([{ name: 'default', ttl: 60_000, limit: 1000 },
      { name: 'auth', ttl: 60_000, limit: 1000 }, { name: 'chat', ttl: 60_000, limit: 1000 }]).compile();
    const adapter = module.get(MediaGatewayMockAdapter);
    const submit = adapter.submit.bind(adapter);
    jest.spyOn(adapter, 'submit').mockImplementation(async (...args) => { submissions++; return submit(...args); });
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(port, '127.0.0.1');
    return app.getHttpServer().address().port as number;
  }

  beforeAll(async () => {
    database = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await database.$connect();
  });
  afterAll(async () => {
    stopClient?.(new Error('Client integration teardown'));
    // Jest's test timeout must not bypass the child/reconstruction barrier.
    await clientActivity?.catch(() => undefined);
    try {
      try { await app?.close(); } finally {
        await database.mediaGatewayRequest.deleteMany({ where: { enterpriseId } });
        const scope = JSON.stringify([enterpriseId, subscriptionId, memberId, 'integration-user']);
        await database.mediaGatewayQuote.deleteMany({ where: { scope } });
        await database.mediaGatewayReference.deleteMany({ where: { scope } });
      }
    } finally { await database.$disconnect(); }
  }, 90_000);

  it('uses client service and atomic files against real Nest endpoints, including both-side reconstruction', async () => {
    const script = resolve(clientRoot!, 'scripts/test-sep-media-integration.ts');
    if (!existsSync(script)) throw new Error('SEP_MEDIA_TEST_CLIENT_ROOT does not contain the client integration runner');
    const port = await start();
    const output = await (clientActivity = new Promise<string>((done, reject) => {
      const child = spawn(process.execPath, ['--import', 'tsx', script], { cwd: clientRoot, env: { ...process.env,
        SEP_MEDIA_TEST_URL: `http://127.0.0.1:${port}/api`, SEP_MEDIA_TEST_TOKEN: token,
        SEP_MEDIA_TEST_FOREIGN_TOKEN: foreignToken, SEP_MEDIA_TEST_ENTERPRISE: enterpriseId,
        SEP_MEDIA_TEST_MEMBER: memberId, SEP_MEDIA_TEST_SUBSCRIPTION: subscriptionId,
      }, stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '', stderr = '', closed = false;
      let failure: Error | undefined;
      let restart: Promise<void> | undefined;
      let killTimer: NodeJS.Timeout | undefined;
      const terminate = (error: Error) => {
        failure ??= error;
        if (closed) return;
        child.kill('SIGTERM');
        killTimer ??= setTimeout(() => { if (!closed) child.kill('SIGKILL'); }, 1000);
      };
      stopClient = terminate;
      const timer = setTimeout(() => terminate(new Error('Client integration timed out')), 60_000);
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
        if (!restart && !failure && stdout.includes('SEP_MEDIA_RESTART_READY\n')) {
          restart = (async () => {
            await app!.close();
            if (closed || failure) return;
            await database.$disconnect();
            if (closed || failure) return;
            await database.$connect();
            if (closed || failure) return;
            await start(port);
            if (!closed && !failure) child.stdin.write('RESUME\n');
          })().catch(error => terminate(error instanceof Error ? error : new Error('Server reconstruction failed')));
        }
      });
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
      child.on('error', terminate);
      child.stdin.on('error', terminate);
      child.on('close', code => {
        closed = true;
        clearTimeout(timer);
        if (killTimer) clearTimeout(killTimer);
        // Teardown cannot race a still-running child or server reconstruction.
        void (async () => {
          await restart;
          if (failure) reject(failure);
          else if (code !== 0) reject(new Error(`Client integration failed (${code}): ${stdout}\n${stderr}`));
          else done(stdout);
        })();
      });
    }));
    expect(output).toContain('SEP_MEDIA_INTEGRATION_PASSED');
    expect(sessionsChecked).toBeGreaterThan(20);
    const records = await database.mediaGatewayRequest.count({ where: { enterpriseId } });
    expect(submissions).toBe(records);
    expect(records).toBeGreaterThanOrEqual(6);
  }, 90_000);
});
