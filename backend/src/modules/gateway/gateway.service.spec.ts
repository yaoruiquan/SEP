import { BadGatewayException, HttpException } from '@nestjs/common';
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

  beforeEach(() => {
    service = new GatewayService({} as never, {} as never, {} as never, {} as never);
    jest.spyOn(service, 'getSub2ApiConfig').mockResolvedValue({
      baseUrl: 'https://relay.test/v1/', apiKey: 'test-key', defaultModel: 'test-model',
    });
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => jest.restoreAllMocks());

  it('forwards the validated request only through sub2api', async () => {
    const upstream = new Response('{}');
    fetchMock.mockResolvedValue(upstream);
    expect(await service.forwardChatCompletion(dto)).toBe(upstream);
    expect(fetchMock).toHaveBeenCalledWith('https://relay.test/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-key' },
      body: JSON.stringify(dto),
    });
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
      expect((exception as HttpException).getResponse()).toEqual({ error });
    }
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
