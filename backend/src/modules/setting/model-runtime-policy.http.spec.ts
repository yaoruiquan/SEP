import { ConflictException, Controller, Get, Inject, INestApplication, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  MODEL_RUNTIME_POLICY_KEYS, MODEL_RUNTIME_POLICY_REVISION, MODEL_RUNTIME_POLICY_LEGACY_KEYS,
} from 'shared';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter';
import { RolesGuard } from '../../common/guards/roles.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ModelRuntimePolicyService } from './model-runtime-policy.service';
import { SettingController } from './setting.controller';
import { SettingService } from './setting.service';

@Controller('api')
class RuntimePolicyProbeController {
  constructor(@Inject('RUNTIME_POLICY_PROBE') private readonly policy: ModelRuntimePolicyService) {}

  @Get(['conversation/model-policy-probe', 'gateway/model-policy-probe'])
  snapshot() { return this.policy.getSnapshot(); }
}

describe('Model runtime policy HTTP contract and permissions', () => {
  let app: INestApplication;
  let policy: Record<string, jest.Mock>;
  let prisma: any;
  const paths = [
    { method: 'get', path: '/settings/model-runtime-policy' },
    { method: 'put', path: '/settings/model-runtime-policy' },
    { method: 'get', path: '/settings/model-runtime-policy/history' },
    { method: 'post', path: '/settings/model-runtime-policy/restore' },
  ];
  const body = { expectedVersion: 1, updates: { GATEWAY_MEMBER_RPM: '150' }, reason: '  verified capacity  ' };

  beforeEach(async () => {
    policy = {
      getForAdmin: jest.fn().mockResolvedValue({ version: 1, fields: [], effectivePolicy: {}, warnings: [], errors: [], writeEnabled: false }),
      update: jest.fn().mockResolvedValue({ version: 2, changes: [], message: 'saved' }),
      history: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
      restore: jest.fn().mockResolvedValue({ version: 3, changes: [], message: 'restored' }),
    };
    prisma = { systemSetting: { findMany: jest.fn().mockResolvedValue([]), upsert: jest.fn(), deleteMany: jest.fn() } };
    const settings = new SettingService(prisma, { getOrThrow: () => 'test-master-key', get: () => undefined } as any);
    const module = await Test.createTestingModule({
      controllers: [SettingController, RuntimePolicyProbeController],
      providers: [
        { provide: ModelRuntimePolicyService, useValue: policy },
        { provide: 'RUNTIME_POLICY_PROBE', useValue: new ModelRuntimePolicyService(prisma, { get: () => undefined } as any) },
        { provide: SettingService, useValue: settings },
        RolesGuard,
      ],
    }).overrideGuard(JwtAuthGuard).useValue({
      canActivate(context: any) {
        const req = context.switchToHttp().getRequest();
        // Stub only token verification; keep the real ADMIN RolesGuard and HTTP validation pipes.
        const token = req.headers.authorization;
        if (!token) throw new UnauthorizedException();
        req.user = { id: token === 'Bearer admin' ? 'admin-user' : 'ordinary-user', role: token === 'Bearer admin' ? 'ADMIN' : token === 'Bearer enterprise-admin' ? 'ENTERPRISE_ADMIN' : 'USER' };
        return true;
      },
    }).compile();
    app = module.createNestApplication();
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterEach(async () => { await app.close(); });

  it.each(paths)('returns 401 for an unauthenticated $method $path', async ({ method, path }) => {
    await request(app.getHttpServer())[method](path).send(body).expect(401);
    for (const method of Object.values(policy)) expect(method).not.toHaveBeenCalled();
  });

  it.each(paths.flatMap((path) => ['user', 'enterprise-admin'].map((role) => ({ ...path, role }))))('returns 403 for $role on $method $path', async ({ method, path, role }) => {
    await request(app.getHttpServer())[method](path).set('Authorization', `Bearer ${role}`).send(body).expect(403);
    for (const method of Object.values(policy)) expect(method).not.toHaveBeenCalled();
  });

  it('serves the dedicated admin view and routes sanitized updates with actor identity from req.user', async () => {
    const view = await request(app.getHttpServer()).get('/settings/model-runtime-policy').set('Authorization', 'Bearer admin').expect(200);
    expect(view.body).toMatchObject({ version: 1, writeEnabled: false });
    await request(app.getHttpServer()).put('/settings/model-runtime-policy').set('Authorization', 'Bearer admin').send(body).expect(200);
    expect(policy.update).toHaveBeenCalledWith({ ...body, reason: 'verified capacity' }, 'admin-user');
  });

  it('validates cursor pagination and returns empty history without unrelated audit data', async () => {
    const result = await request(app.getHttpServer()).get('/settings/model-runtime-policy/history?cursor=history-1&limit=100').set('Authorization', 'Bearer admin').expect(200);
    expect(result.body).toEqual({ items: [], nextCursor: null });
    expect(policy.history).toHaveBeenCalledWith({ cursor: 'history-1', limit: 100 });
    await request(app.getHttpServer()).get('/settings/model-runtime-policy/history?limit=101').set('Authorization', 'Bearer admin').expect(400);
    expect(policy.history).toHaveBeenCalledTimes(1);
  });

  it('passes validated restore requests and does not accept a client-supplied actor', async () => {
    const restore = { expectedVersion: 2, historyId: 'history-1', side: 'before', reason: ' rollback ' };
    await request(app.getHttpServer()).post('/settings/model-runtime-policy/restore').set('Authorization', 'Bearer admin').send(restore).expect(201);
    expect(policy.restore).toHaveBeenCalledWith({ ...restore, reason: 'rollback' }, 'admin-user');
    await request(app.getHttpServer()).post('/settings/model-runtime-policy/restore').set('Authorization', 'Bearer admin').send({ ...restore, actorId: 'other-admin' }).expect(400);
    expect(policy.restore).toHaveBeenCalledTimes(1);
  });

  it.each(['SUB2API_API_KEY', MODEL_RUNTIME_POLICY_REVISION, ...MODEL_RUNTIME_POLICY_LEGACY_KEYS, 'UNKNOWN'])('rejects forbidden update key %s at the HTTP DTO boundary', async (key) => {
    await request(app.getHttpServer()).put('/settings/model-runtime-policy').set('Authorization', 'Bearer admin').send({ ...body, updates: { [key]: '100' } }).expect(400);
    expect(policy.update).not.toHaveBeenCalled();
  });

  it.each([
    { ...body, updates: {} }, { ...body, expectedVersion: -1 },
    { ...body, reason: ' ' }, { ...body, updates: { GATEWAY_MEMBER_RPM: 150 } },
    { ...body, updates: { GATEWAY_MEMBER_RPM: '0' } }, { ...body, actorId: 'other' },
  ])('rejects malformed updates without service calls %p', async (invalid) => {
    await request(app.getHttpServer()).put('/settings/model-runtime-policy').set('Authorization', 'Bearer admin').send(invalid).expect(400);
    expect(policy.update).not.toHaveBeenCalled();
  });

  it('preserves the existing exception envelope and status on version conflicts', async () => {
    policy.update.mockRejectedValue(new ConflictException({
      code: 'MODEL_RUNTIME_POLICY_VERSION_CONFLICT', expectedVersion: 1, currentVersion: 3,
      message: '模型运行策略版本冲突：提交版本 1，当前版本 3；请重新加载并保留草稿。',
    }));
    const result = await request(app.getHttpServer()).put('/settings/model-runtime-policy').set('Authorization', 'Bearer admin').send(body).expect(409);
    expect(result.body).toMatchObject({ statusCode: 409, message: expect.stringContaining('当前版本 3') });
    expect(result.body.timestamp).toBeDefined();
    expect(result.body.path).toBe('/settings/model-runtime-policy');
  });

  it('enforces the backend release gate even when called directly', async () => {
    policy.update.mockRejectedValue(new ServiceUnavailableException('模型运行策略写入未开放'));
    await request(app.getHttpServer()).put('/settings/model-runtime-policy').set('Authorization', 'Bearer admin').send(body).expect(503);
  });

  it.each(['/api/conversation/model-policy-probe', '/api/gateway/model-policy-probe'])('preserves a known policy version and platform configuration errors on %s', async (path) => {
    prisma.systemSetting.findMany.mockResolvedValueOnce([
      { key: MODEL_RUNTIME_POLICY_REVISION, value: '7' }, { key: 'GATEWAY_MEMBER_RPM', value: '0' },
    ]);
    const result = await request(app.getHttpServer()).get(path).expect(503);
    expect(result.body).toMatchObject({
      statusCode: 503, message: expect.stringContaining('GATEWAY_MEMBER_RPM'),
      error: {
        source: 'platform', type: 'server_error', code: 'MODEL_RUNTIME_POLICY_INVALID',
        message: expect.stringContaining('GATEWAY_MEMBER_RPM'), policyVersion: 7,
      },
    });
    expect(result.body.error.message).toBe(result.body.message);
  });

  it.each(['/api/conversation/model-policy-probe', '/api/gateway/model-policy-probe'])('preserves platform database errors without inventing a policy version on %s', async (path) => {
    prisma.systemSetting.findMany.mockRejectedValueOnce(new Error('private database credentials'));
    const result = await request(app.getHttpServer()).get(path).expect(503);
    expect(result.body).toMatchObject({
      statusCode: 503, message: '模型运行策略依赖不可用，请稍后重试',
      error: { source: 'platform', type: 'server_error', code: 'MODEL_RUNTIME_POLICY_UNAVAILABLE', message: '模型运行策略依赖不可用，请稍后重试' },
    });
    expect(result.body.error).not.toHaveProperty('policyVersion');
    expect(JSON.stringify(result.body)).not.toContain('private database credentials');
  });

  it.each(['/api/conversation/model-policy-probe', '/api/gateway/model-policy-probe'])('preserves invalid revision errors without inventing a policy version on %s', async (path) => {
    prisma.systemSetting.findMany.mockResolvedValueOnce([{ key: MODEL_RUNTIME_POLICY_REVISION, value: 'corrupt' }]);
    const result = await request(app.getHttpServer()).get(path).expect(503);
    expect(result.body).toMatchObject({
      statusCode: 503, message: '模型运行策略内部版本无效，请检查配置',
      error: { source: 'platform', type: 'server_error', code: 'MODEL_RUNTIME_POLICY_INVALID', message: '模型运行策略内部版本无效，请检查配置' },
    });
    expect(result.body.error).not.toHaveProperty('policyVersion');
  });

  it.each([...MODEL_RUNTIME_POLICY_KEYS, MODEL_RUNTIME_POLICY_REVISION, ...MODEL_RUNTIME_POLICY_LEGACY_KEYS])('prevents generic PUT bypass for %s before any database write', async (key) => {
    await request(app.getHttpServer()).put('/settings').set('Authorization', 'Bearer admin').send({ MAIL_HOST: 'smtp.example.com', [key]: '100' }).expect(400);
    expect(prisma.systemSetting.upsert).not.toHaveBeenCalled();
    expect(prisma.systemSetting.deleteMany).not.toHaveBeenCalled();
  });

  it('requires shared Zod validation for the generic settings body as well', async () => {
    await request(app.getHttpServer()).put('/settings').set('Authorization', 'Bearer admin').send({ MAIL_HOST: 100 }).expect(400);
    expect(prisma.systemSetting.upsert).not.toHaveBeenCalled();
  });
});
