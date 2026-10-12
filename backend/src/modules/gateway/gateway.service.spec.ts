import { BadGatewayException, HttpException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SETTING_KEYS } from 'shared';
import { GatewayService } from './gateway.service';
import { GatewayModelPolicyService } from './gateway-model-policy.service';
import { policySnapshot } from './gateway-policy.test-fixtures';

jest.mock('../setting/setting.service', () => ({ SettingService: jest.fn() }));

const enterpriseClaims = {
  sub: 'user-1',
  enterpriseId: 'enterprise-1',
  subscriptionId: 'subscription-1',
  memberId: 'member-1',
};

describe('GatewayService.getSub2ApiConfig', () => {
  it.each(['', null, undefined])('structures a missing API key %p without exposing configuration values', async (apiKey) => {
    const getEffectiveValue = jest.fn().mockImplementation(async (key: string) => (
      key === SETTING_KEYS.SUB2API_API_KEY ? apiKey : 'private-config-value'
    ));
    const service = new GatewayService(
      {} as never, new ConfigService(), { getEffectiveValue } as never, {} as never, {} as never,
    );
    const error = await service.getSub2ApiConfig().catch((failure) => failure);
    expect(error).toBeInstanceOf(HttpException);
    expect(error.getStatus()).toBe(400);
    expect(error.message).toBe('sub2api API Key 未配置');
    expect(error.getResponse()).toEqual({
      message: 'sub2api API Key 未配置',
      error: {
        message: 'sub2api API Key 未配置', code: 'GATEWAY_CONFIG_INVALID',
        source: 'platform', param: null, type: 'server_error',
      },
    });
    expect(JSON.stringify(error.getResponse())).not.toContain('private-config-value');
  });

  it('propagates unknown configuration lookup errors unchanged', async () => {
    const failure = new Error('unexpected configuration lookup failure');
    const service = new GatewayService(
      {} as never, new ConfigService(),
      { getEffectiveValue: jest.fn().mockRejectedValue(failure) } as never, {} as never, {} as never,
    );
    await expect(service.getSub2ApiConfig()).rejects.toBe(failure);
  });
});

describe('GatewayService.forwardChatCompletion', () => {
  const dto = { model: 'test-model', messages: [{ role: 'user' as const, content: 'hello' }] };
  let service: GatewayService;
  let fetchMock: jest.SpyInstance;
  let warnMock: jest.SpyInstance;

  beforeEach(() => {
    service = new GatewayService({} as never, new ConfigService(), {} as never, {} as never, {} as never);
    jest.spyOn(service, 'getSub2ApiConfig').mockResolvedValue({
      baseUrl: 'https://relay.test/v1/', apiKey: 'test-key', defaultModel: 'test-model',
    });
    fetchMock = jest.spyOn(global, 'fetch');
    warnMock = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('forwards the validated request only through sub2api', async () => {
    const upstream = new Response('{}');
    fetchMock.mockResolvedValue(upstream);
    expect(await (await service.forwardChatCompletion(dto, policySnapshot())).json()).toEqual({});
    expect(fetchMock).toHaveBeenCalledWith('https://relay.test/v1/chat/completions', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-key' },
      body: JSON.stringify(dto),
    }));
  });

  it('forwards the optional platform request id without changing the payload', async () => {
    fetchMock.mockResolvedValue(new Response('{}'));
    await (await service.forwardChatCompletion(dto, policySnapshot(), 'platform-request-123')).body!.cancel();
    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      headers: {
        'Content-Type': 'application/json', Authorization: 'Bearer test-key',
        'x-request-id': 'platform-request-123',
      },
      body: JSON.stringify(dto),
    }));
    expect(warnMock).not.toHaveBeenCalled();
  });

  it.each([400, 429, 503])('preserves upstream HTTP %i and structured error details', async (status) => {
    const error = { message: 'invalid tool message', type: 'invalid_request_error', code: 'invalid_tool', param: 'messages[2].tool_call_id' };
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error }), { status }));
    try {
      await service.forwardChatCompletion(dto, policySnapshot());
      throw new Error('Expected upstream rejection');
    } catch (exception) {
      expect(exception).toBeInstanceOf(HttpException);
      expect((exception as HttpException).getStatus()).toBe(status);
      expect((exception as HttpException).getResponse()).toEqual({
        error: { ...error, ...(status === 429 ? { source: 'upstream' } : {}) },
      });
    }
  });

  it.each([
    ['17', 17],
    ['0', 0],
    [' 23 ', 23],
    ['Sat, 10 Oct 2026 00:00:18 GMT', 18],
    ['Saturday, 10-Oct-26 00:00:18 GMT', 18],
    ['Sat Oct 10 00:00:18 2026', 18],
    ['Sat, 10 Oct 2026 00:00:00 GMT', 0],
    ['Fri, 09 Oct 2026 23:59:50 GMT', 0],
  ])('normalizes upstream Retry-After %s to %i seconds', async (retryAfter, expected) => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-10T00:00:00.100Z'));
    fetchMock.mockResolvedValue(new Response('{}', {
      status: 429, headers: { 'Retry-After': retryAfter, 'x-request-id': 'upstream-123' },
    }));
    await expect(service.forwardChatCompletion(dto, policySnapshot(), 'platform-123')).rejects.toMatchObject({
      status: 429,
      response: {
        error: {
          message: 'sub2api 请求失败（HTTP 429）', type: 'rate_limit_error',
          code: 'UPSTREAM_RATE_LIMIT_EXCEEDED', param: null, source: 'upstream',
        },
        retryAfterSeconds: expected,
      },
    });
    expect(warnMock).toHaveBeenCalledWith({
      message: 'sub2api rate limit', status: 429, requestId: 'platform-123',
      upstreamRequestId: 'upstream-123', retryAfterSeconds: expected,
    });
  });

  it.each([null, '', '-1', '1.5', 'NaN', 'Infinity', 'tomorrow', '2026-10-10',
    '9007199254740992', 'Tue, 31 Feb 2026 00:00:00 GMT', 'Sat, 10 Oct 2026 25:00:00 GMT'])(
    'does not present invalid/missing Retry-After %p as known waiting information', async (retryAfter) => {
      fetchMock.mockResolvedValue(new Response('not-json', {
        status: 429, headers: retryAfter === null ? {} : { 'Retry-After': retryAfter },
      }));
      const exception = await service.forwardChatCompletion(dto, policySnapshot()).catch((error: HttpException) => error);
      expect(exception).toBeInstanceOf(HttpException);
      expect((exception as HttpException).getStatus()).toBe(429);
      expect((exception as HttpException).getResponse()).toMatchObject({
        error: { source: 'upstream', code: 'UPSTREAM_RATE_LIMIT_EXCEEDED' },
      });
      expect((exception as HttpException).getResponse()).not.toHaveProperty('retryAfterSeconds');
      expect(warnMock.mock.calls[0][0]).not.toHaveProperty('retryAfterSeconds');
    },
  );

  it('rejects unsafe upstream error field types without exposing nested objects', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: {
      message: { secret: 'private' }, type: ['private'], code: 123, param: { token: 'private' },
    } }), { status: 429 }));
    const exception = await service.forwardChatCompletion(dto, policySnapshot()).catch((error: HttpException) => error);
    expect((exception as HttpException).getResponse()).toEqual({
      error: {
        message: 'sub2api 请求失败（HTTP 429）', type: 'rate_limit_error',
        code: 'UPSTREAM_RATE_LIMIT_EXCEEDED', param: null, source: 'upstream',
      },
    });
  });

  it('logs only safe correlation metadata and strips upstream error metadata', async () => {
    const upstream = new Response(JSON.stringify({
      error: {
        message: 'Quota exceeded', type: 'rate_limit_error', code: 'existing_code', param: 'model',
        source: 'platform', rateLimit: { limit: 1, secret: 'private' },
        credentials: 'private-key', headers: { authorization: 'private-key' },
      },
      debug: 'private-body',
    }), { status: 429, headers: { 'x-request-id': `upstream [31m"${'a'.repeat(300)}` } });
    fetchMock.mockResolvedValue(upstream);

    const exception = await service.forwardChatCompletion(dto, policySnapshot(), 'platform-123').catch((error: HttpException) => error);
    expect((exception as HttpException).getResponse()).toEqual({
      error: {
        message: 'Quota exceeded', type: 'rate_limit_error', code: 'existing_code',
        param: 'model', source: 'upstream',
      },
    });
    const logged = warnMock.mock.calls[0][0];
    expect(logged).toEqual({
      message: 'sub2api rate limit', status: 429, requestId: 'platform-123',
      upstreamRequestId: expect.stringMatching(/^[a-zA-Z0-9._:-]{128}$/),
    });
    expect(JSON.stringify(logged)).not.toMatch(/private|hello|test-key|Quota|existing_code/);
  });

  it('ignores Retry-After on non-429 errors and does not add rate limit metadata', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 503, headers: { 'Retry-After': '12' } }));
    const exception = await service.forwardChatCompletion(dto, policySnapshot()).catch((error: HttpException) => error);
    expect((exception as HttpException).getResponse()).toEqual({
      error: { message: 'sub2api 请求失败（HTTP 503）', type: 'api_error', code: 'UPSTREAM_ERROR', param: null },
    });
    expect(warnMock).toHaveBeenCalledWith(expect.objectContaining({ message: 'sub2api request rejected', status: 503 }));
  });

  it.each(['', '<html>private proxy diagnostics</html>'])('gives a readable fallback without echoing a raw proxy body', async (body) => {
    fetchMock.mockResolvedValue(new Response(body, { status: 502 }));
    await expect(service.forwardChatCompletion(dto, policySnapshot())).rejects.toMatchObject({
      response: { error: { message: 'sub2api 请求失败（HTTP 502）', code: 'UPSTREAM_ERROR' } },
      status: 502,
    });
  });

  it('maps transport failures to 502 without exposing internal connection details', async () => {
    fetchMock.mockRejectedValue(new Error('secret internal connection detail'));
    await expect(service.forwardChatCompletion(dto, policySnapshot())).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('forces usage collection for streams even if the caller disables it', async () => {
    const snapshot = policySnapshot();
    const policy = new GatewayModelPolicyService({} as never, { platformModel: {
      findFirst: jest.fn().mockResolvedValue({ maxOutputTokens: null, supportedFeatures: null }),
    } } as never, new ConfigService());
    jest.spyOn(policy, 'resolvePolicy').mockResolvedValue({
      allowedModels: [dto.model], defaultModel: dto.model, allowUserSwitchModel: true, departmentId: null,
    });
    service = new GatewayService({} as never, new ConfigService(), {} as never, {} as never, policy);
    jest.spyOn(service, 'getSub2ApiConfig').mockResolvedValue({
      baseUrl: 'https://relay.test/v1/', apiKey: 'test-key', defaultModel: dto.model,
    });
    const input = { ...dto, stream: true, stream_options: { include_usage: false } };
    const prepared = await service.prepareRequest(enterpriseClaims, input, snapshot);
    expect(input.stream_options.include_usage).toBe(false);
    expect(prepared.request.stream_options).toEqual({ include_usage: true });
    expect(prepared.inputBytes).toBe(Buffer.byteLength(JSON.stringify(prepared.request)));
    fetchMock.mockResolvedValue(new Response('data:[DONE]\n\n'));
    const response = await service.forwardChatCompletion(prepared.request, snapshot);
    expect(fetchMock.mock.calls[0][1].body).toBe(JSON.stringify(prepared.request));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ stream_options: { include_usage: true } });
    await response.body!.cancel();
  });

  it('bounds error response bodies', async () => {
    fetchMock.mockResolvedValue(new Response('x'.repeat(65537), { status: 429 }));
    await expect(service.forwardChatCompletion(dto, policySnapshot())).rejects.toMatchObject({
      response: { error: { code: 'UPSTREAM_RESPONSE_TOO_LARGE' } }, status: 502,
    });
  });
});

describe('GatewayService.prepareRequest snapshot normalization', () => {
  const request = { model: 'test-model', messages: [{ role: 'user' as const, content: 'hello' }] };
  const snapshot = policySnapshot({ GATEWAY_DEFAULT_MAX_TOKENS: 4096 });
  let findFirst: jest.Mock;
  let service: GatewayService;

  beforeEach(() => {
    findFirst = jest.fn().mockResolvedValue({ maxOutputTokens: 1000, supportedFeatures: null });
    const policy = new GatewayModelPolicyService({} as never, { platformModel: { findFirst } } as never, new ConfigService());
    jest.spyOn(policy, 'resolvePolicy').mockResolvedValue({
      allowedModels: [request.model], defaultModel: request.model, allowUserSwitchModel: true, departmentId: null,
    });
    service = new GatewayService({} as never, new ConfigService(), {} as never, {} as never, policy);
  });

  afterEach(() => jest.restoreAllMocks());

  it('normalizes to the model cap before returning the exact serialized request', async () => {
    const result = await service.prepareRequest(enterpriseClaims, request, snapshot);
    expect(result.request).toEqual({ ...request, max_tokens: 1000 });
    expect(result.inputBytes).toBe(Buffer.byteLength(JSON.stringify(result.request)));
    expect(findFirst).toHaveBeenCalledWith({
      where: { modelId: request.model, enabled: true, isStale: false },
      select: { maxOutputTokens: true, supportedFeatures: true },
    });
  });

  it('rejects model overflow and invalid metadata before admission can run', async () => {
    await expect(service.prepareRequest(enterpriseClaims, { ...request, max_tokens: 1001 }, snapshot)).rejects.toMatchObject({
      status: 400, response: { error: { code: 'MODEL_OUTPUT_LIMIT_EXCEEDED', limit: 1000, policyVersion: 7 } },
    });
    findFirst.mockResolvedValue({ maxOutputTokens: -1, supportedFeatures: null });
    await expect(service.prepareRequest(enterpriseClaims, request, snapshot)).rejects.toMatchObject({ status: 400 });
  });

  it('preserves streaming capability checks with snapshot normalization enabled', async () => {
    findFirst.mockResolvedValue({ maxOutputTokens: 1000, supportedFeatures: { streaming: false } });
    await expect(service.prepareRequest(enterpriseClaims, { ...request, stream: true }, snapshot)).rejects.toThrow('streaming');
  });
});

describe('GatewayService.compute credit integration', () => {
  const snapshot = policySnapshot();
  const enabledModel = { modelId: 'test-model' };
  const modelConfig = { allowedChatModels: ['test-model'] };
  const balanceAllowed = {
    allowed: true,
    enterpriseFundsAllowed: true,
    creditRemainingCNY: 0,
    walletBalanceCNY: 9699,
    memberWalletBalanceCNY: 0,
    totalAvailableCNY: 9699,
    personalBalanceCNY: 0,
  };
  let prisma: Record<string, any>;
  let creditService: { checkBalanceBeforeConversation: jest.Mock; chargeUsage: jest.Mock };
  let service: GatewayService;
  let prepare: jest.Mock;

  beforeEach(() => {
    prisma = {
      subscription: { findFirst: jest.fn().mockResolvedValue({ id: 'subscription-1', employeeId: 'employee-1' }) },
      employeeGrant: { findFirst: jest.fn().mockResolvedValue({ id: 'grant-1' }) },
      platformModel: { findMany: jest.fn().mockResolvedValue([enabledModel]) },
      enterpriseModelConfig: { findUnique: jest.fn().mockResolvedValue(modelConfig) },
    };
    creditService = {
      checkBalanceBeforeConversation: jest.fn().mockResolvedValue(balanceAllowed),
      chargeUsage: jest.fn().mockResolvedValue({
        alreadyCharged: false,
        usageRecordId: 'usage-1',
        unpaidCNY: 0,
      }),
    };
    prepare = jest.fn().mockResolvedValue({ allowedModels: ['test-model'], request: {}, inputBytes: 2 });
    service = new GatewayService(
      prisma as never,
      new ConfigService(),
      {} as never,
      creditService as never,
      { prepare } as never,
    );
  });

  it('uses the unified credit balance instead of the legacy ComputeAccount', async () => {
    const result = await service.validateAndAuthorize(enterpriseClaims);

    expect(result).toEqual({
      enterpriseId: 'enterprise-1',
      subscriptionId: 'subscription-1',
      memberId: 'member-1',
      employeeId: 'employee-1',
    });
    expect(creditService.checkBalanceBeforeConversation).toHaveBeenCalledWith(
      'enterprise-1',
      'subscription-1',
      'user-1',
    );
    expect(prisma.computeAccount).toBeUndefined();
  });

  it('rejects the request when the unified credit service disallows the conversation', async () => {
    creditService.checkBalanceBeforeConversation.mockResolvedValue({
      ...balanceAllowed,
      allowed: false,
      reason: '企业和个人算力余额均不足',
    });

    await expect(service.validateAndAuthorize(enterpriseClaims)).rejects.toMatchObject({
      status: 403,
      message: '企业和个人算力余额均不足',
      response: { error: {
        message: '企业和个人算力余额均不足', code: 'INSUFFICIENT_BALANCE',
        source: 'platform', param: null, type: 'permission_error',
      } },
    });
  });

  it.each([
    ['subscription', 'SUBSCRIPTION_INACTIVE', '订阅不存在、已停用或不属于该企业'],
    ['employeeGrant', 'SUBSCRIPTION_ACCESS_DENIED', '无该订阅的使用授权或授权已过期'],
  ])('returns a stable platform contract for rejected %s', async (model, code, message) => {
    prisma[model].findFirst.mockResolvedValue(null);
    const error = await service.validateAndAuthorize(enterpriseClaims).catch((failure) => failure);
    expect(error).toBeInstanceOf(HttpException);
    expect(error.getStatus()).toBe(403);
    expect(error.message).toBe(message);
    expect(error.getResponse()).toEqual({ message, error: {
      message, code, source: 'platform', param: null, type: 'permission_error',
    } });
    expect(creditService.checkBalanceBeforeConversation).not.toHaveBeenCalled();
    if (model === 'subscription') expect(prisma.employeeGrant.findFirst).not.toHaveBeenCalled();
  });

  it('keeps the fallback balance message in the structured error', async () => {
    creditService.checkBalanceBeforeConversation.mockResolvedValue({ ...balanceAllowed, allowed: false });
    await expect(service.validateAndAuthorize(enterpriseClaims)).rejects.toMatchObject({
      status: 403,
      response: { error: {
        message: '企业算力余额不足，请联系管理员充值', code: 'INSUFFICIENT_BALANCE',
        source: 'platform', param: null, type: 'permission_error',
      } },
    });
  });

  it.each(['subscription', 'employeeGrant', 'balance', 'policy'])('propagates unknown %s errors unchanged', async (step) => {
    const failure = new Error('unexpected failure');
    if (step === 'balance') creditService.checkBalanceBeforeConversation.mockRejectedValue(failure);
    else if (step === 'policy') prepare.mockRejectedValue(failure);
    else prisma[step].findFirst.mockRejectedValue(failure);
    const operation = step === 'policy'
      ? service.prepareRequest(enterpriseClaims, { model: 'test-model', messages: [] }, snapshot)
      : service.validateAndAuthorize(enterpriseClaims);
    await expect(operation).rejects.toBe(failure);
  });

  it('delegates resource limits and effective model policy to the policy service', async () => {
    const dto = { model: 'test-model', messages: [{ role: 'user' as const, content: 'hello' }] };
    const result = await service.prepareRequest(enterpriseClaims, dto, snapshot);
    expect(result).toEqual({ allowedModels: ['test-model'], request: {}, inputBytes: 2 });
    expect(prepare).toHaveBeenCalledWith(enterpriseClaims, dto, snapshot);
    expect(creditService.chargeUsage).not.toHaveBeenCalled();
  });
});
