import { describe, expect, it } from 'vitest';
import { BUDGET_KEY, buildPolicyUpdates, createPolicyDraft, isDedicatedPolicySetting, isLegacyPolicySetting, rebasePolicyDraft } from './model-runtime-policy-form';
import { policyFixture } from './model-runtime-policy.fixtures';

describe('模型策略草稿', () => {
  it('只提交改动，整数秒精确转为毫秒', () => {
    const view = policyFixture();
    const draft = createPolicyDraft(view);
    expect(buildPolicyUpdates(view, draft)).toEqual({ updates: {}, errors: [] });
    draft.values.GATEWAY_STREAM_HEADER_TIMEOUT_MS = '91';
    expect(buildPolicyUpdates(view, draft)).toEqual({ updates: { GATEWAY_STREAM_HEADER_TIMEOUT_MS: '91000' }, errors: [] });
  });

  it.each(['1.5', '-1', '0', '121', '1e2'])('拒绝非法秒输入 %s，不截断或静默舍入', (input) => {
    const view = policyFixture();
    const draft = createPolicyDraft(view);
    draft.values.GATEWAY_STREAM_HEADER_TIMEOUT_MS = input;
    expect(buildPolicyUpdates(view, draft).errors).not.toHaveLength(0);
  });

  it('取消覆盖发送空字符串，不把当前有效值当成环境回退', () => {
    const view = policyFixture(1, { GATEWAY_STREAM_HEADER_TIMEOUT_MS: '90000' });
    const draft = createPolicyDraft(view);
    draft.values.GATEWAY_STREAM_HEADER_TIMEOUT_MS = '';
    expect(buildPolicyUpdates(view, draft)).toEqual({ updates: { GATEWAY_STREAM_HEADER_TIMEOUT_MS: '' }, errors: [] });
  });

  it('既有非整秒毫秒值未编辑时原样保留，不自动舍入或重写', () => {
    const view = policyFixture(1, { GATEWAY_STREAM_HEADER_TIMEOUT_MS: '1500' });
    const draft = createPolicyDraft(view);
    expect(draft.values.GATEWAY_STREAM_HEADER_TIMEOUT_MS).toBe('1.5');
    expect(buildPolicyUpdates(view, draft)).toEqual({ updates: {}, errors: [] });
    draft.values.GATEWAY_STREAM_HEADER_TIMEOUT_MS = '2';
    expect(buildPolicyUpdates(view, draft).updates.GATEWAY_STREAM_HEADER_TIMEOUT_MS).toBe('2000');
  });

  it('预算关闭保存 0，保留正整数草稿，重新开启恢复原输入', () => {
    const view = policyFixture();
    const draft = createPolicyDraft(view);
    draft.budgetMode = 'override';
    draft.budgetEnabled = true;
    draft.values[BUDGET_KEY] = '234567';
    expect(buildPolicyUpdates(view, draft).updates[BUDGET_KEY]).toBe('234567');
    draft.budgetEnabled = false;
    expect(buildPolicyUpdates(view, draft).updates[BUDGET_KEY]).toBe('0');
    expect(draft.values[BUDGET_KEY]).toBe('234567');
    draft.budgetEnabled = true;
    expect(buildPolicyUpdates(view, draft).updates[BUDGET_KEY]).toBe('234567');
  });

  it('预算开启不能填 0 或空值，其他数字不能用 0 关闭', () => {
    const view = policyFixture();
    const draft = createPolicyDraft(view);
    draft.budgetMode = 'override';
    draft.budgetEnabled = true;
    expect(buildPolicyUpdates(view, draft).errors).not.toHaveLength(0);
    draft.values[BUDGET_KEY] = '0';
    expect(buildPolicyUpdates(view, draft).errors).not.toHaveLength(0);
    draft.budgetEnabled = false;
    draft.values.GATEWAY_MEMBER_CONCURRENCY = '0';
    expect(buildPolicyUpdates(view, draft).errors).not.toHaveLength(0);
  });

  it('复用共享跨字段校验：总时长、企业阈值及默认输出', () => {
    const view = policyFixture();
    const draft = createPolicyDraft(view);
    draft.values.GATEWAY_STREAM_TOTAL_TIMEOUT_MS = '60';
    draft.values.GATEWAY_ENTERPRISE_RPM = '10';
    draft.values.MODEL_MAX_OUTPUT_TOKENS = '100';
    expect(buildPolicyUpdates(view, draft).errors.length).toBeGreaterThanOrEqual(3);
  });

  it('重载保留编辑字段和预算输入，不把未改字段写回旧版本', () => {
    const previous = policyFixture(1, { GATEWAY_MEMBER_RPM: '130' });
    const draft = createPolicyDraft(previous);
    draft.values.GATEWAY_STREAM_HEADER_TIMEOUT_MS = '90';
    draft.budgetMode = 'override';
    draft.values[BUDGET_KEY] = '500';
    const next = policyFixture(2, { GATEWAY_MEMBER_RPM: '150' });
    const rebased = rebasePolicyDraft(previous, next, draft);
    expect(rebased.values.GATEWAY_STREAM_HEADER_TIMEOUT_MS).toBe('90');
    expect(rebased.values[BUDGET_KEY]).toBe('500');
    expect(rebased.values.GATEWAY_MEMBER_RPM).toBe('150');
    expect(buildPolicyUpdates(next, rebased).updates.GATEWAY_MEMBER_RPM).toBeUndefined();
  });

  it('专用键和停用键不会进入通用写入', () => {
    expect(isDedicatedPolicySetting('MODEL_RUNTIME_POLICY_REVISION')).toBe(true);
    expect(isDedicatedPolicySetting('GATEWAY_MEMBER_RPM')).toBe(true);
    expect(isDedicatedPolicySetting('PLATFORM_NAME')).toBe(false);
    expect(isLegacyPolicySetting('MODEL_RESPONSE_TIMEOUT')).toBe(true);
    expect(isLegacyPolicySetting('MAX_CONCURRENT_SESSIONS')).toBe(true);
    expect(isLegacyPolicySetting('MAX_TOKENS_PER_CONVERSATION')).toBe(true);
  });
});
