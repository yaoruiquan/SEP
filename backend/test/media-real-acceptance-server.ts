import 'reflect-metadata';
import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { Decimal } from '@prisma/client/runtime/library';
import cookieParser from 'cookie-parser';
import type { RequestHandler } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { basicRateLimitMiddleware } from '../src/common/middleware/basic-rate-limit.middleware';
import { createJsonBodyMiddleware } from '../src/common/middleware/json-body.middleware';
import { requestContextMiddleware } from '../src/common/middleware/request-context.middleware';
import type { SessionService } from '../src/modules/auth/session.service';
import type { ClientService } from '../src/modules/client/client.service';
import type { PrismaService } from '../src/prisma/prisma.service';

/**
 * Local fixtures only; never migrates, tops up an existing wallet, or calls upstream.
 * Required: NODE_ENV=test|development, MEDIA_REAL_ACCEPTANCE_SERVER=true,
 * MEDIA_REAL_TEST_DATABASE_URL, MEDIA_REAL_TEST_REDIS_URL, MEDIA_BASE_URL,
 * MEDIA_API_KEY and MEDIA_REAL_ACCEPTANCE_TOKEN_FILE (outside the repo, parent 0700).
 * Upstream: HTTPS loopback or the explicitly authorized longdaoai.cn:443 sub2api.
 * Optional: MEDIA_REAL_ACCEPTANCE_PORT=3012, MEDIA_REAL_ACCEPTANCE_FIXTURE=<batch>,
 * MEDIA_REAL_ACCEPTANCE_BALANCE_CNY=0 (maximum 10),
 * MEDIA_REAL_ACCEPTANCE_ALLOW_EXECUTION=true (default: requests POST is blocked).
 * Schema must already exist. A fixture name is single-use; restart never refills it.
 */
export class MediaAcceptanceConfigurationError extends Error {}
const invalid = (message: string): never => { throw new MediaAcceptanceConfigurationError(message); };
type Environment = Record<string, string | undefined>;
const repoRoot = resolve(__dirname, '../..');
const loopback = (url: URL) => ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);

function localUrl(value: string | undefined): URL {
  try { return new URL(value ?? ''); } catch { invalid('Explicit local connection URL required'); }
}

export function mediaAcceptanceSettings(env: Environment) {
  if (env.MEDIA_REAL_ACCEPTANCE_SERVER !== 'true' || !['test', 'development'].includes(env.NODE_ENV ?? '') || env.E2E_TEST === '1') {
    invalid('Requires explicit MEDIA_REAL_ACCEPTANCE_SERVER=true and test/development without E2E_TEST');
  }
  const database = localUrl(env.MEDIA_REAL_TEST_DATABASE_URL);
  const allowedDbOptions = new Set(['schema', 'connection_limit', 'connect_timeout']);
  if (!['postgres:', 'postgresql:'].includes(database.protocol) || !loopback(database) ||
      !/^\/sep_media_real_[a-z0-9_]+$/.test(database.pathname) || database.hash ||
      [...database.searchParams].some(([key, value]) => !allowedDbOptions.has(key) ||
        (key === 'schema' ? value !== 'public' : !/^[1-9]\d{0,2}$/.test(value))) ||
      [...database.searchParams.keys()].some(key => database.searchParams.getAll(key).length !== 1)) {
    invalid('Database must be loopback sep_media_real_* with only public schema/connection limits');
  }
  const redis = localUrl(env.MEDIA_REAL_TEST_REDIS_URL);
  if (redis.protocol !== 'redis:' || !loopback(redis) || !/^\/(?:[1-9]|1[0-5])$/.test(redis.pathname) || redis.search || redis.hash) {
    invalid('Requires explicit loopback Redis database 1..15; DB 0 is not isolated');
  }
  const upstream = localUrl(env.MEDIA_BASE_URL);
  const authorizedUpstream = loopback(upstream) || (upstream.hostname === 'longdaoai.cn' && !upstream.port);
  if (upstream.protocol !== 'https:' || !authorizedUpstream || upstream.username || upstream.password ||
      upstream.search || upstream.hash || !['/', '/v1', '/v1/'].includes(upstream.pathname) || env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
    invalid('MEDIA_BASE_URL requires HTTPS loopback or authorized longdaoai.cn:443, root or /v1; TLS bypass is forbidden');
  }
  if (!env.MEDIA_API_KEY?.trim() || env.MEDIA_API_KEY.length > 4096 || /[\r\n]/.test(env.MEDIA_API_KEY)) {
    invalid('MEDIA_API_KEY must be supplied in memory');
  }
  const rawPort = env.MEDIA_REAL_ACCEPTANCE_PORT ?? '3012';
  const port = /^\d+$/.test(rawPort) ? Number(rawPort) : NaN;
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535 || [3001, 3002].includes(port)) {
    invalid('Requires separate MEDIA_REAL_ACCEPTANCE_PORT (default 3012)');
  }
  const fixture = env.MEDIA_REAL_ACCEPTANCE_FIXTURE ?? randomUUID().replace(/-/g, '');
  if (!/^[a-z0-9][a-z0-9_]{2,39}$/.test(fixture)) invalid('Fixture name must contain 3..40 lowercase letters/digits/underscores');
  const balance = env.MEDIA_REAL_ACCEPTANCE_BALANCE_CNY ?? '0';
  if (!/^\d{1,2}(?:\.\d{1,6})?$/.test(balance) || new Decimal(balance).greaterThan(10)) {
    invalid('Local fixture balance must be between 0 and 10 CNY, at most six decimals');
  }
  if (env.MEDIA_REAL_ACCEPTANCE_ALLOW_EXECUTION !== undefined && !['true', 'false'].includes(env.MEDIA_REAL_ACCEPTANCE_ALLOW_EXECUTION)) {
    invalid('MEDIA_REAL_ACCEPTANCE_ALLOW_EXECUTION must be true or false');
  }
  const tokenFile = env.MEDIA_REAL_ACCEPTANCE_TOKEN_FILE;
  const withinRepo = tokenFile && relative(repoRoot, resolve(tokenFile));
  if (!tokenFile || !isAbsolute(tokenFile) || !withinRepo || (!withinRepo.startsWith('..' + '/') && !isAbsolute(withinRepo))) {
    invalid('Token file must be an absolute path outside the repository');
  }
  return {
    databaseUrl: database.href, redisUrl: redis.href, port, fixture, tokenFile,
    balanceCny: new Decimal(balance).toFixed(6), allowExecution: env.MEDIA_REAL_ACCEPTANCE_ALLOW_EXECUTION === 'true',
    // This allowlist intentionally excludes all inherited business/cloud/payment credentials.
    runtime: {
      NODE_ENV: env.NODE_ENV, DATABASE_URL: database.href, REDIS_URL: redis.href,
      JWT_SECRET: randomBytes(32).toString('hex'), ACCESS_JWT_SECRET: randomBytes(32).toString('hex'),
      REFRESH_TOKEN_PEPPER: randomBytes(32).toString('hex'), REFRESH_TOKEN_EXPIRES_IN: '1h',
      CLIENT_TOKEN_TTL_MINUTES: '15', USD_TO_CNY_RATE: '7.2', MAIL_ENABLED: 'false',
      MEDIA_GATEWAY_REAL_ENABLED: 'true', MEDIA_GATEWAY_MOCK_ENABLED: 'false',
      MEDIA_BASE_URL: upstream.href, MEDIA_API_KEY: env.MEDIA_API_KEY,
    },
  };
}
export type MediaAcceptanceSettings = ReturnType<typeof mediaAcceptanceSettings>;

export async function openMediaAcceptanceTokenFile(path: string) {
  const parent = await lstat(dirname(path));
  if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o777) !== 0o700 || parent.uid !== process.getuid?.()) {
    invalid('Token parent must be an existing owner-only 0700 directory');
  }
  const resolvedParent = await realpath(dirname(path));
  const resolvedRepo = await realpath(repoRoot);
  if (resolvedParent === resolvedRepo || resolvedParent.startsWith(`${resolvedRepo}/`)) {
    invalid('Token directory must not resolve inside the repository');
  }
  // Exclusive create rejects symlinks, existing files, FIFOs and accidental overwrites.
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  const created = await handle.stat();
  return {
    async write(value: unknown) { await handle.writeFile(`${JSON.stringify(value)}\n`); await handle.sync(); },
    async close() {
      try {
        const current = await lstat(path).catch(() => undefined);
        if (current?.ino === created.ino && current?.dev === created.dev) await unlink(path);
      } finally { await handle.close(); }
    },
  };
}

export function mediaAcceptanceHttpBoundary(allowExecution: boolean): RequestHandler {
  return (req, res, next) => {
    const path = req.path.replace(/\/+$/, '').toLowerCase();
    const root = '/api/gateway/v1/media/real';
    const read = req.method === 'GET' && (path === `${root}/profiles` || path.startsWith(`${root}/requests/`));
    const prepare = req.method === 'POST' && [`${root}/quotes`, `${root}/references`].includes(path);
    const submit = req.method === 'POST' && path === `${root}/requests`;
    if (read || prepare || (submit && allowExecution)) return next();
    res.status(submit ? 403 : 404).json({ error: { code: submit ? 'LOCAL_EXECUTION_DISABLED' : 'LOCAL_ROUTE_DISABLED' } });
  };
}

export async function createMediaAcceptanceFixture(prisma: PrismaService, local: MediaAcceptanceSettings) {
  const prefix = `media-real-acceptance-${local.fixture}`;
  const expiresAt = new Date(Date.now() + 60 * 60_000);
  return prisma.$transaction(async tx => {
    // DB overrides win over environment. Refuse them, never modify another run's settings.
    const overrides = await tx.systemSetting.count({ where: { key: { in: [
      'MEDIA_BASE_URL', 'MEDIA_API_KEY', 'CLIENT_TOKEN_TTL_MINUTES', 'USD_TO_CNY_RATE',
    ] } } });
    if (overrides) invalid('Isolated DB has connection/TTL/rate overrides; use a clean acceptance database');
    if (await tx.user.findUnique({ where: { email: `${prefix}@fixture.invalid` }, select: { id: true } })) {
      invalid('Fixture already exists; choose a new batch (existing balances are never refilled)');
    }
    const user = await tx.user.create({ data: { email: `${prefix}@fixture.invalid`, name: `${prefix} LOCAL FIXTURE`, role: 'USER' } });
    const enterprise = await tx.enterprise.create({ data: { name: `${prefix} LOCAL FIXTURE`, metadata: { localAcceptanceFixture: true, batch: local.fixture } } });
    const member = await tx.enterpriseMember.create({ data: { userId: user.id, enterpriseId: enterprise.id, role: 'MEMBER' } });
    const employee = await tx.digitalEmployee.create({ data: {
      name: prefix, description: 'Local media HTTP acceptance fixture, not a production employee', industry: 'testing',
      position: 'media-acceptance', systemPrompt: 'Local media acceptance fixture', status: 'APPROVED',
      modelId: 'gpt-image-2', includedComputeCNY: 0,
    } });
    const capability = await tx.capability.create({ data: {
      name: `${prefix}-skill`, description: 'Local acceptance media skill fixture', type: 'SKILL',
      industry: ['testing'], position: ['media-acceptance'], inputSchema: {}, outputSchema: {},
      contributorId: user.id, enterpriseId: enterprise.id, status: 'APPROVED', enterpriseReviewStatus: 'APPROVED',
    } });
    const version = await tx.skillVersion.create({ data: {
      capabilityId: capability.id, scope: 'ENTERPRISE', enterpriseId: enterprise.id, status: 'ENTERPRISE_APPROVED',
      version: '1.0.0', content: '# Local media acceptance\nUse image_generate or image_edit only after explicit confirmation.',
      createdById: user.id, enterpriseReviewedAt: new Date(),
    } });
    await tx.employeeCapabilityBinding.create({ data: { employeeId: employee.id, capabilityId: capability.id, defaultSkillVersionId: version.id } });
    const subscription = await tx.subscription.create({ data: {
      enterpriseId: enterprise.id, employeeId: employee.id, templateVersion: '1.0.0', name: prefix, endDate: expiresAt,
    } });
    await tx.employeeGrant.create({ data: { subscriptionId: subscription.id, memberId: member.id, expiresAt } });
    // Synthetic local personal funds only: no enterprise credit, top-ups, recharge or payment records.
    await tx.personalWallet.create({ data: { userId: user.id, balance: local.balanceCny } });
    const profile = await tx.mediaModelProfile.create({ data: {
      profileId: `acceptance-${local.fixture}`, displayName: `${local.fixture} LOCAL FIXTURE`, modelId: 'gpt-image-2',
      configVersion: `local-${randomUUID()}`, operations: ['generate', 'edit'], executionMode: 'sync-response',
      capabilities: { supportsReferenceImage: true, maxOutputs: 1, sizes: ['1024x1024'] },
      // Fixture attestation only; this does not assert that upstream execution has been verified.
      enabled: true, verified: true,
    } });
    await tx.enterpriseModelConfig.create({ data: { enterpriseId: enterprise.id, mediaPolicy: {
      enabledProfileIds: [profile.profileId], defaultProfileId: profile.profileId, allowedOperations: ['generate', 'edit'],
      maxOutputs: 1, maxWidth: 1024, maxHeight: 1024,
    } } });
    const device = await tx.device.create({ data: { userId: user.id, fingerprint: prefix, platform: process.platform } });
    return { userId: user.id, enterpriseId: enterprise.id, memberId: member.id, subscriptionId: subscription.id,
      deviceId: device.id, profileId: profile.profileId, expiresAt: expiresAt.toISOString() };
  }, { isolationLevel: 'Serializable', timeout: 15_000 });
}

export async function startMediaAcceptanceServer(env: Environment = process.env) {
  const local = mediaAcceptanceSettings(env);
  Logger.overrideLogger(false);
  const delivery = await openMediaAcceptanceTokenFile(local.tokenFile);
  let moduleRef: TestingModule | undefined;
  let app: INestApplication | undefined;
  let sessions: SessionService | undefined;
  let sessionId: string | undefined;
  let closing: Promise<void> | undefined;
  const previousEnvironment = process.env;
  // This ConfigService version falls back to process.env even with ignoreEnvVars.
  // Prisma also reads process.env directly. Keep both on the same explicit allowlist.
  const hostEnvironment: Environment = {};
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'TZ', 'LANG', 'NODE_EXTRA_CA_CERTS']) {
    if (previousEnvironment[key] !== undefined) hostEnvironment[key] = previousEnvironment[key];
  }
  // Generated Prisma clients may auto-load .env. They must not inject or replace
  // anything here, including settings that ConfigService would otherwise inherit.
  process.env = new Proxy({ ...hostEnvironment, ...local.runtime }, {
    set: () => true, defineProperty: () => false, deleteProperty: () => false,
  });
  const close = () => closing ??= (async () => {
    try {
      if (sessionId) await sessions?.revokeSession(sessionId, 'local_acceptance_shutdown');
    } finally {
      try { if (app) await app.close(); else await moduleRef?.close(); }
      finally {
        try { await delivery.close(); }
        finally {
          process.env = previousEnvironment;
        }
      }
    }
  })();
  try {
    // Lazy imports ensure validation and the explicit Prisma DSN precede module initialization.
    const [client, media, security, redis, prisma, session] = await Promise.all([
      import('../src/modules/client/client.module'), import('../src/modules/media-gateway/media-gateway.module'),
      import('../src/modules/security/security.module'), import('../src/redis/redis.service'),
      import('../src/prisma/prisma.service'), import('../src/modules/auth/session.service'),
    ]);
    const config = await ConfigModule.forRoot({
      isGlobal: true, ignoreEnvFile: true, ignoreEnvVars: true, load: [() => local.runtime],
    });
    moduleRef = await Test.createTestingModule({ imports: [config, security.SecurityModule, client.ClientModule, media.MediaGatewayModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false, bodyParser: false });
    app.setGlobalPrefix('api');
    app.use(mediaAcceptanceHttpBoundary(local.allowExecution));
    app.use(requestContextMiddleware, basicRateLimitMiddleware, createJsonBodyMiddleware(), cookieParser());
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
    await app.get(redis.RedisService).redis.ping();
    const fixture = await createMediaAcceptanceFixture(app.get(prisma.PrismaService), local);
    sessions = app.get(session.SessionService);
    const created = await sessions.createSession({ userId: fixture.userId, clientType: 'DESKTOP', deviceId: fixture.deviceId, refreshTtlSeconds: 3600 });
    sessionId = created.sessionId;
    const { ClientService: ClientServiceClass } = await import('../src/modules/client/client.service');
    const tokens = await app.get<ClientService>(ClientServiceClass).refreshInstanceToken({ refreshToken: created.refreshToken, subscriptionId: fixture.subscriptionId });
    // Neither session refresh tokens nor upstream credentials are delivered or logged.
    await app.listen(local.port, '127.0.0.1');
    const baseUrl = `http://127.0.0.1:${local.port}/api`;
    await delivery.write({ baseUrl, employmentToken: tokens.employmentToken, expiresIn: tokens.expiresIn,
      ...fixture, balanceCny: local.balanceCny, localFixtureOnly: true, executionEnabled: local.allowExecution });
    return { app, fixture, baseUrl, close };
  } catch (error) { await close(); throw error; }
}

export async function mediaAcceptanceServerCli() {
  let stopping = false;
  let server: Awaited<ReturnType<typeof startMediaAcceptanceServer>> | undefined;
  const stop = () => { stopping = true; if (server) void server.close().catch(reportCloseFailure); };
  const reportCloseFailure = () => { console.error('MEDIA_REAL_ACCEPTANCE_SERVER_CLOSE_FAILED (details suppressed)'); process.exitCode = 1; };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    server = await startMediaAcceptanceServer();
    if (stopping) await server.close();
    else console.log(`MEDIA_REAL_ACCEPTANCE_SERVER_READY ${server.baseUrl}`);
  } catch (error) {
    console.error(error instanceof MediaAcceptanceConfigurationError
      ? `MEDIA_REAL_ACCEPTANCE_SERVER_CONFIG_ERROR: ${error.message}`
      : 'MEDIA_REAL_ACCEPTANCE_SERVER_START_FAILED (details suppressed)');
    process.exitCode = 1;
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}

if (require.main === module) void mediaAcceptanceServerCli();
