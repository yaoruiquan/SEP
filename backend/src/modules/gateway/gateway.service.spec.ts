import { BadGatewayException, HttpException, Logger } from '@nestjs/common';
import { GatewayService } from './gateway.service';

const enterpriseClaims = {
  sub: 'user-1',
  enterpriseId: 'enterprise-1',
  subscriptionId: 'subscription-1',
  memberId: 'member-1',
};

describe('GatewayService.forwardChatCompletion', () => {
  const dto = { model: 'test-model', messages: [{ role: 'user' as const, content: 'hello' }] };
  let service: GatewayService;
  let fetchMock: jest.SpyInstance;
  let warnMock: jest.SpyInstance;

  beforeEach(() => {
    service = new GatewayService({} as never, {} as never, {} as never, {} as never);
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
    expect(await service.forwardChatCompletion(dto)).toBe(upstream);
    expect(fetchMock).toHaveBeenCalledWith('https://relay.test/v1/chat/completions', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-key' },
      body: JSON.stringify(dto),
    }));
  });

  it('forwards the optional platform request id without changing the payload', async () => {
    fetchMock.mockResolvedValue(new Response('{}'));
    await service.forwardChatCompletion(dto, 'platform-request-123');
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
      await service.forwardChatCompletion(dto);
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
    await expect(service.forwardChatCompletion(dto, 'platform-123')).rejects.toMatchObject({
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
      const exception = await service.forwardChatCompletion(dto).catch((error: HttpException) => error);
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
    const exception = await service.forwardChatCompletion(dto).catch((error: HttpException) => error);
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
    }), { status: 429 });
    jest.spyOn(upstream.headers, 'get').mockImplementation((name) =>
      name.toLowerCase() === 'x-request-id' ? `upstream\r\n\u001b[31m"${'a'.repeat(300)}` : null,
    );
    fetchMock.mockResolvedValue(upstream);

    const exception = await service.forwardChatCompletion(dto, 'platform-123').catch((error: HttpException) => error);
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
    const exception = await service.forwardChatCompletion(dto).catch((error: HttpException) => error);
    expect((exception as HttpException).getResponse()).toEqual({
      error: { message: 'sub2api 请求失败（HTTP 503）', type: 'api_error', code: 'UPSTREAM_ERROR', param: null },
    });
    expect(warnMock).not.toHaveBeenCalled();
  });

  it.each(['', '<html>private proxy diagnostics</html>'])('gives a readable fallback without echoing a raw proxy body', async (body) => {
    fetchMock.mockResolvedValue(new Response(body, { status: 502 }));
    await expect(service.forwardChatCompletion(dto)).rejects.toMatchObject({
      response: { error: { message: 'sub2api 请求失败（HTTP 502）', code: 'UPSTREAM_ERROR' } },
      status: 502,
    });
  });

  it('maps transport failures to 502 without exposing internal connection details', async () => {
    fetchMock.mockRejectedValue(new Error('secret internal connection detail'));
    await expect(service.forwardChatCompletion(dto)).rejects.toBeInstanceOf(BadGatewayException);
  });
});

describe('GatewayService.compute credit integration', () => {
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
    service = new GatewayService(
      prisma as never,
      {} as never,
      {} as never,
      creditService as never,
    );
  });

  it('uses the unified credit balance instead of the legacy ComputeAccount', async () => {
    const result = await service.validateAndAuthorize(enterpriseClaims);

    expect(result).toEqual({
      enterpriseId: 'enterprise-1',
      subscriptionId: 'subscription-1',
      memberId: 'member-1',
      employeeId: 'employee-1',
      allowedModels: ['test-model'],
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

    await expect(service.validateAndAuthorize(enterpriseClaims)).rejects.toThrow('企业和个人算力余额均不足');
  });

  it('charges usage through ComputeCreditService and preserves the idempotency anchors', async () => {
    await service.recordTransaction({
      enterpriseId: 'enterprise-1',
      subscriptionId: 'subscription-1',
      memberId: 'member-1',
      employeeId: 'employee-1',
      userId: 'user-1',
      sessionId: 'session-1',
      messageId: 'message-1',
      modelId: 'test-model',
      usage: { prompt_tokens: 12, completion_tokens: 8 } as never,
    });

    expect(creditService.chargeUsage).toHaveBeenCalledWith({
      enterpriseId: 'enterprise-1',
      subscriptionId: 'subscription-1',
      employeeId: 'employee-1',
      userId: 'user-1',
      sessionId: 'session-1',
      messageId: 'message-1',
      modelId: 'test-model',
      inputTokens: 12,
      outputTokens: 8,
    });
    expect(prisma.computeAccount).toBeUndefined();
  });
});
