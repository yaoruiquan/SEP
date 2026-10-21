import { ConfigService } from '@nestjs/config';
import { GatewayModelPolicyService } from './gateway-model-policy.service';
import { policySnapshot } from './gateway-policy.test-fixtures';

describe('Gateway upstream-managed output budgets', () => {
  const service = new GatewayModelPolicyService({} as never, {} as never, new ConfigService({
    GATEWAY_DEFAULT_MAX_TOKENS: 0, MODEL_MAX_OUTPUT_TOKENS: 0,
  }));
  const upstream = () => policySnapshot({ GATEWAY_DEFAULT_MAX_TOKENS: 0,
    WEB_DEFAULT_MAX_OUTPUT_TOKENS: 0, PLANNER_MAX_OUTPUT_TOKENS: 0, MODEL_MAX_OUTPUT_TOKENS: 0 });

  it.each([{}, { maxOutputTokens: 65536 }])('leaves omitted budgets omitted with capability %p', model => {
    const request = { model: 'test-model', messages: [] };
    expect(service.normalize(request, model, upstream())).toEqual(request);
    expect(service.normalize(request, model)).toEqual(request);
    expect(service.internalOutputTokens(model, upstream(), 0)).toBeUndefined();
  });

  it('passes explicit budgets above the former platform ceiling without changing them', () => {
    expect(service.normalize({ max_tokens: 65536 }, {}, upstream())).toEqual({ max_tokens: 65536 });
    expect(service.internalOutputTokens(null, upstream(), 65536)).toBe(65536);
  });

  it('keeps enforcing known model capability for explicit budgets', () => {
    expect(() => service.normalize({ max_tokens: 65537 }, { maxOutputTokens: 65536 }, upstream()))
      .toThrow(expect.objectContaining({ status: 400 }));
  });

  it('still enforces an explicitly configured platform ceiling when the default is zero', () => {
    const policy = policySnapshot({ GATEWAY_DEFAULT_MAX_TOKENS: 0, MODEL_MAX_OUTPUT_TOKENS: 8192 });
    expect(service.normalize({}, {}, policy)).toEqual({ max_tokens: 8192 });
    expect(service.internalOutputTokens({ maxOutputTokens: 4096 }, policy, 0)).toBe(4096);
    expect(() => service.normalize({ max_tokens: 8193 }, {}, policy)).toThrow();
  });
});
