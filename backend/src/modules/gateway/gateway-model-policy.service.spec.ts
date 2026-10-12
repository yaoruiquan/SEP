import { BadRequestException, ForbiddenException, InternalServerErrorException, PayloadTooLargeException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnterpriseModelConfigService } from '../enterprise-model-config/enterprise-model-config.service';
import { ClientService } from '../client/client.service';
import { ChatCompletionRequestSchema } from 'shared';
import { GatewayModelPolicyService } from './gateway-model-policy.service';

const identity = { sub: 'user-1', enterpriseId: 'ent-1', memberId: 'member-1', subscriptionId: 'sub-1' };

function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    enterpriseId: 'ent-1', defaultChatModel: 'model-a', allowedChatModels: [] as string[],
    allowUserSwitchModel: true, employeeModelPolicy: 'FOLLOW_TEMPLATE', employeeDefaultModel: null,
    rerankModel: null, createdAt: new Date(), updatedAt: new Date(), ...overrides,
  };
}

function request(overrides: Record<string, unknown> = {}) {
  return ChatCompletionRequestSchema.parse({
    model: 'model-a', messages: [{ role: 'user', content: 'hello' }], ...overrides,
  });
}

describe('GatewayModelPolicyService', () => {
  let prisma: any;
  let config: ConfigService;
  let context: any;
  let modelConfig: EnterpriseModelConfigService;
  let service: GatewayModelPolicyService;

  beforeEach(() => {
    prisma = {
      enterpriseMember: { findFirst: jest.fn().mockResolvedValue({ departmentId: 'dept-current' }) },
      enterpriseModelConfig: {
        findUnique: jest.fn().mockResolvedValue(makeConfig()),
        create: jest.fn().mockResolvedValue(makeConfig()),
      },
      departmentModelPolicy: { findUnique: jest.fn().mockResolvedValue(null) },
      subscription: {
        findFirst: jest.fn().mockResolvedValue({ employee: { modelId: 'model-template' } }),
        findUnique: jest.fn().mockResolvedValue({ config: { modelId: 'model-subscription' } }),
      },
      platformModel: {
        findMany: jest.fn().mockResolvedValue([
          { modelId: 'model-a' }, { modelId: 'model-b' },
          { modelId: 'model-template' }, { modelId: 'model-subscription' },
        ]),
        findFirst: jest.fn().mockResolvedValue({ maxOutputTokens: null, supportedFeatures: null }),
      },
      employeeGrant: { findMany: jest.fn() },
    };
    config = new ConfigService();
    context = { resolve: jest.fn() };
    modelConfig = new EnterpriseModelConfigService(prisma, context, config);
    service = new GatewayModelPolicyService(modelConfig, prisma, config);
  });

  it('matches member, enterprise and user together and uses the current department only', async () => {
    const policy = await service.resolvePolicy(identity);
    expect(prisma.enterpriseMember.findFirst).toHaveBeenCalledWith({
      where: { id: 'member-1', enterpriseId: 'ent-1', userId: 'user-1' }, select: { departmentId: true },
    });
    expect(prisma.departmentModelPolicy.findUnique).toHaveBeenCalledWith({
      where: { departmentId: 'dept-current' }, select: { defaultChatModel: true, allowedChatModels: true },
    });
    expect(context.resolve).not.toHaveBeenCalled();
    expect(policy.departmentId).toBe('dept-current');
    expect(prisma.platformModel.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { enabled: true, isStale: false },
    }));
  });

  it('rejects missing or mismatched members before reading policies or model metadata', async () => {
    prisma.enterpriseMember.findFirst.mockResolvedValue(null);
    await expect(service.prepare(identity, request())).rejects.toThrow(ForbiddenException);
    expect(prisma.subscription.findFirst).not.toHaveBeenCalled();
    expect(prisma.platformModel.findMany).not.toHaveBeenCalled();
    expect(prisma.platformModel.findFirst).not.toHaveBeenCalled();
  });

  it('rejects a subscription outside the claimed enterprise', async () => {
    prisma.subscription.findFirst.mockResolvedValue(null);
    await expect(service.resolvePolicy(identity)).rejects.toThrow(ForbiddenException);
    expect(prisma.subscription.findFirst).toHaveBeenCalledWith({
      where: { id: 'sub-1', enterpriseId: 'ent-1' }, select: { employee: { select: { modelId: true } } },
    });
  });

  it('intersects enterprise and department allowlists without allowing department expansion', async () => {
    prisma.enterpriseModelConfig.findUnique.mockResolvedValue(makeConfig({ allowedChatModels: ['model-a'] }));
    prisma.departmentModelPolicy.findUnique.mockResolvedValue({
      defaultChatModel: 'model-a', allowedChatModels: ['model-a', 'model-b'],
    });
    expect((await service.resolvePolicy(identity)).allowedModels).toEqual(['model-a']);
    await expect(service.prepare(identity, request({ model: 'model-b' }))).rejects.toThrow(ForbiddenException);
    expect(prisma.platformModel.findFirst).not.toHaveBeenCalled();
  });

  it('does not reinterpret an empty intersection as unrestricted', async () => {
    prisma.enterpriseModelConfig.findUnique.mockResolvedValue(makeConfig({ allowedChatModels: ['model-a'] }));
    prisma.departmentModelPolicy.findUnique.mockResolvedValue({ defaultChatModel: null, allowedChatModels: ['model-b'] });
    expect((await service.resolvePolicy(identity)).allowedModels).toEqual([]);
    await expect(service.prepare(identity, request())).rejects.toThrow(ForbiddenException);
  });

  it('treats empty allowlists as no restriction at that level', async () => {
    prisma.departmentModelPolicy.findUnique.mockResolvedValue({ defaultChatModel: null, allowedChatModels: ['model-b'] });
    expect((await service.resolvePolicy(identity)).allowedModels).toEqual(['model-b']);
    prisma.departmentModelPolicy.findUnique.mockResolvedValue({ defaultChatModel: null, allowedChatModels: [] });
    prisma.enterpriseModelConfig.findUnique.mockResolvedValue(makeConfig({ allowedChatModels: ['model-a'] }));
    expect((await service.resolvePolicy(identity)).allowedModels).toEqual(['model-a']);
  });

  it('disabling switching limits requests to the department or enterprise default', async () => {
    prisma.enterpriseModelConfig.findUnique.mockResolvedValue(makeConfig({ allowUserSwitchModel: false }));
    prisma.departmentModelPolicy.findUnique.mockResolvedValue({ defaultChatModel: 'model-b', allowedChatModels: [] });
    const policy = await service.resolvePolicy(identity);
    expect(policy).toMatchObject({ allowedModels: ['model-b'], defaultModel: 'model-b', allowUserSwitchModel: false });
    await expect(service.prepare(identity, request())).rejects.toThrow(ForbiddenException);
    await expect(service.prepare(identity, request({ model: 'model-b' }))).resolves.toMatchObject({ request: { model: 'model-b', max_tokens: 4096 } });
    expect(prisma.subscription.findUnique).not.toHaveBeenCalled();
  });

  it('FORCE_DEFAULT uses its employee default and disallows model switching', async () => {
    prisma.enterpriseModelConfig.findUnique.mockResolvedValue(makeConfig({
      employeeModelPolicy: 'FORCE_DEFAULT', employeeDefaultModel: 'model-b',
    }));
    expect(await service.resolvePolicy(identity)).toMatchObject({
      allowedModels: ['model-b'], defaultModel: 'model-b', allowUserSwitchModel: false,
    });
    await expect(service.prepare(identity, request())).rejects.toThrow(ForbiddenException);
  });

  it.each([
    { allowUserSwitchModel: false, defaultChatModel: 'stale' },
    { employeeModelPolicy: 'FORCE_DEFAULT', employeeDefaultModel: 'disabled' },
    { allowUserSwitchModel: false, allowedChatModels: ['model-b'] },
  ])('fails explicitly on an unavailable or excluded forced default: %j', async (overrides) => {
    prisma.enterpriseModelConfig.findUnique.mockResolvedValue(makeConfig(overrides));
    await expect(service.resolvePolicy(identity)).rejects.toMatchObject({
      response: { error: { code: 'MODEL_POLICY_DEFAULT_INVALID' } },
    });
  });

  it('preserves subscription > template > department > enterprise default precedence', async () => {
    prisma.departmentModelPolicy.findUnique.mockResolvedValue({ defaultChatModel: 'model-b', allowedChatModels: [] });
    expect((await service.resolvePolicy(identity)).defaultModel).toBe('model-subscription');
    prisma.subscription.findUnique.mockResolvedValue({ config: {} });
    expect((await service.resolvePolicy(identity)).defaultModel).toBe('model-template');
    prisma.subscription.findFirst.mockResolvedValue({ employee: { modelId: null } });
    expect((await service.resolvePolicy(identity)).defaultModel).toBe('model-b');
    prisma.departmentModelPolicy.findUnique.mockResolvedValue(null);
    expect((await service.resolvePolicy(identity)).defaultModel).toBe('model-a');
  });

  it('prepares a copy with default output tokens and never silently replaces the requested model', async () => {
    const dto = request({ model: 'model-b' });
    const prepared = await service.prepare(identity, dto);
    expect(prepared.request).toMatchObject({ model: 'model-b', max_tokens: 4096 });
    expect(dto).not.toHaveProperty('max_tokens');
    expect(prepared.inputBytes).toBe(Buffer.byteLength(JSON.stringify(prepared.request), 'utf8'));
  });

  it('caps an omitted max_tokens, but rejects an explicit limit beyond the model cap', async () => {
    prisma.platformModel.findFirst.mockResolvedValue({ maxOutputTokens: 2048, supportedFeatures: null });
    expect((await service.prepare(identity, request())).request.max_tokens).toBe(2048);
    await expect(service.prepare(identity, request({ max_tokens: 2049 }))).rejects.toThrow(BadRequestException);
    expect((await service.prepare(identity, request({ max_tokens: 2048 }))).request.max_tokens).toBe(2048);
  });

  it('bounds explicit output budgets by the platform default when the model cap is unknown', async () => {
    expect((await service.prepare(identity, request({ max_tokens: 4096 }))).request.max_tokens).toBe(4096);
    await expect(service.prepare(identity, request({ max_tokens: 4097 }))).rejects.toThrow(BadRequestException);
    await expect(service.prepare(identity, request({ max_tokens: Number.MAX_SAFE_INTEGER }))).rejects.toThrow(BadRequestException);
  });

  it('treats omitted cap/features metadata as unknown rather than invalid or unsupported', async () => {
    prisma.platformModel.findFirst.mockResolvedValue({});
    const prepared = await service.prepare(identity, request({ stream: true, tools: [
      { type: 'function', function: { name: 'ls' } },
    ] }));
    expect(prepared.request.max_tokens).toBe(4096);
    await expect(service.prepare(identity, request({ max_tokens: 8192 }))).rejects.toThrow(BadRequestException);
  });

  it('uses configured defaults and rejects invalid configuration', async () => {
    jest.spyOn(config, 'get').mockImplementation((key: string) => (
      key === 'GATEWAY_DEFAULT_MAX_TOKENS' ? 1024 : undefined
    ) as never);
    expect((await service.prepare(identity, request())).request.max_tokens).toBe(1024);
    jest.spyOn(config, 'get').mockReturnValue(-1 as never);
    await expect(service.prepare(identity, request())).rejects.toThrow(InternalServerErrorException);
  });

  it.each([0, -1])('rejects invalid model output metadata %s', async (maxOutputTokens) => {
    prisma.platformModel.findFirst.mockResolvedValue({ maxOutputTokens, supportedFeatures: null });
    await expect(service.prepare(identity, request())).rejects.toThrow(BadRequestException);
  });

  it('rechecks enabled/stale status immediately before resource validation', async () => {
    prisma.platformModel.findFirst.mockResolvedValue(null);
    await expect(service.prepare(identity, request())).rejects.toThrow(BadRequestException);
    expect(prisma.platformModel.findFirst).toHaveBeenCalledWith({
      where: { modelId: 'model-a', enabled: true, isStale: false },
      select: { maxOutputTokens: true, supportedFeatures: true },
    });
  });

  it('rejects explicit unsupported features, but accepts missing or unknown metadata', async () => {
    prisma.platformModel.findFirst.mockResolvedValue({ maxOutputTokens: null, supportedFeatures: { streaming: false, functionCalling: false } });
    await expect(service.prepare(identity, request({ stream: true }))).rejects.toThrow('streaming');
    await expect(service.prepare(identity, request({ tools: [{ type: 'function', function: { name: 'ls' } }] }))).rejects.toThrow('functionCalling');
    await expect(service.prepare(identity, request({ tool_choice: 'required' }))).rejects.toThrow('functionCalling');
    await expect(service.prepare(identity, request({ tools: [], tool_choice: 'none', stream: false }))).resolves.toBeDefined();
    for (const supportedFeatures of [null, {}, { streaming: null, functionCalling: null }]) {
      prisma.platformModel.findFirst.mockResolvedValue({ maxOutputTokens: null, supportedFeatures });
      await expect(service.prepare(identity, request({ stream: true, tools: [{ type: 'function', function: { name: 'ls' } }] }))).resolves.toBeDefined();
    }
  });

  it('applies functionCalling support checks to tool continuation history too', async () => {
    prisma.platformModel.findFirst.mockResolvedValue({ maxOutputTokens: null, supportedFeatures: { functionCalling: false } });
    await expect(service.prepare(identity, request({ messages: [
      { role: 'assistant', content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'ls', arguments: '{}' } }] },
      { role: 'tool', content: 'done', tool_call_id: 'call-1' },
    ] }))).rejects.toThrow('functionCalling');
  });

  it('bounds the whole UTF-8 serialization including tools and injected output budget', async () => {
    const dto = request({ messages: [{ role: 'user', content: '中文' }] });
    const bytes = Buffer.byteLength(JSON.stringify({ ...dto, max_tokens: 4096 }), 'utf8');
    jest.spyOn(config, 'get').mockImplementation((key: string) => (
      key === 'GATEWAY_MAX_REQUEST_BYTES' ? bytes : undefined
    ) as never);
    expect((await service.prepare(identity, dto)).inputBytes).toBe(bytes);
    jest.spyOn(config, 'get').mockImplementation((key: string) => (
      key === 'GATEWAY_MAX_REQUEST_BYTES' ? bytes - 1 : undefined
    ) as never);
    await expect(service.prepare(identity, dto)).rejects.toThrow(PayloadTooLargeException);
  });

  it('enforces the default 4 MiB limit without pretending to count context tokens', async () => {
    const content = 'x'.repeat(1024 * 1024);
    await expect(service.prepare(identity, request({ messages: Array(4).fill({ role: 'user', content }) }))).rejects.toThrow(PayloadTooLargeException);
  });

  it('uses the same policy for the client subscription list and prepared requests', async () => {
    prisma.enterpriseModelConfig.findUnique.mockResolvedValue(makeConfig({ employeeModelPolicy: 'FORCE_DEFAULT' }));
    const subscription = {
      id: 'sub-1', employeeId: 'emp-1', name: null, status: 'ACTIVE', templateVersion: '1.0.0',
      employee: { id: 'emp-1', name: 'Employee', avatar: null, version: '1.0.0' },
    };
    prisma.employeeGrant.findMany.mockResolvedValue([{ subscription }, { subscription }]);
    const client = Object.create(ClientService.prototype) as ClientService;
    Object.assign(client, {
      prisma, modelPolicy: service,
      enterpriseContext: { resolve: jest.fn().mockResolvedValue({ enterpriseId: 'ent-1', memberId: 'member-1', departmentId: 'dept-current' }) },
    });
    const listed = await client.listSubscriptions('user-1');
    const prepared = await service.prepare(identity, request());
    expect(listed).toHaveLength(1);
    expect(listed[0].allowedModels).toEqual(prepared.allowedModels);
    expect(listed[0].allowedModels).toEqual(['model-a']);
    expect(prisma.subscription.findFirst).toHaveBeenCalledTimes(2);
    await expect(service.prepare(identity, request({ model: 'model-b' }))).rejects.toThrow(ForbiddenException);
  });
});
