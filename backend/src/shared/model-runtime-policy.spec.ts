import {
  MODEL_RUNTIME_POLICY_FIELDS, MODEL_RUNTIME_POLICY_KEYS, MODEL_RUNTIME_POLICY_REVISION,
  ModelRuntimePolicyHistoryQuerySchema, ModelRuntimePolicyRawValuesSchema,
  RestoreModelRuntimePolicyDtoSchema, UpdateModelRuntimePolicyDtoSchema,
} from './model-runtime-policy';

const defaults = () => Object.fromEntries(MODEL_RUNTIME_POLICY_FIELDS.map((field) => [field.key, field.defaultValue]));
const update = (updates: Record<string, unknown>) => ({ expectedVersion: 0, updates, reason: '  capacity review  ' });

describe('Model runtime policy shared contract', () => {
  it('provides real defaults, metadata and a typed decimal conversion for all 18 keys', () => {
    expect(MODEL_RUNTIME_POLICY_FIELDS.map((field) => field.key)).toEqual([...MODEL_RUNTIME_POLICY_KEYS]);
    const values = ModelRuntimePolicyRawValuesSchema.parse(defaults());
    expect(values.GATEWAY_STREAM_HEADER_TIMEOUT_MS).toBe(120000);
    expect(values.GATEWAY_ENTERPRISE_TOKEN_BUDGET).toBe(0);
    for (const key of ['GATEWAY_DEFAULT_MAX_TOKENS', 'WEB_DEFAULT_MAX_OUTPUT_TOKENS', 'PLANNER_MAX_OUTPUT_TOKENS', 'MODEL_MAX_OUTPUT_TOKENS']) {
      expect(values[key]).toBe(0);
    }
    expect(MODEL_RUNTIME_POLICY_FIELDS.filter((field) => field.unit === 'ms').every((field) => field.displayScale === 1000)).toBe(true);
  });

  it.each(['', ' ', 'NaN', 'Infinity', '1.5', '-1', '0x100', '1e3', false, null])('rejects invalid effective numeric value %p', (value) => {
    expect(ModelRuntimePolicyRawValuesSchema.safeParse({ ...defaults(), GATEWAY_MEMBER_RPM: value }).success).toBe(false);
  });

  it.each([
    { GATEWAY_STREAM_TOTAL_TIMEOUT_MS: '119999' },
    { WEB_MODEL_TOTAL_TIMEOUT_MS: '44000' },
    { GATEWAY_ENTERPRISE_RPM: '119' },
    { GATEWAY_ENTERPRISE_CONCURRENCY: '3' },
    { MODEL_MAX_OUTPUT_TOKENS: '4095', GATEWAY_DEFAULT_MAX_TOKENS: '4096' },
    { MODEL_MAX_OUTPUT_TOKENS: '32768', GATEWAY_DEFAULT_MAX_TOKENS: '32769' },
    { MODEL_MAX_OUTPUT_TOKENS: '32768', WEB_DEFAULT_MAX_OUTPUT_TOKENS: '32769' },
    { MODEL_MAX_OUTPUT_TOKENS: '32768', PLANNER_MAX_OUTPUT_TOKENS: '32769' },
  ])('rejects inconsistent complete policy %p', (changes) => {
    expect(ModelRuntimePolicyRawValuesSchema.safeParse({ ...defaults(), ...changes }).success).toBe(false);
  });

  it.each(MODEL_RUNTIME_POLICY_FIELDS)('checks both hard boundaries for $key', (field) => {
    expect(UpdateModelRuntimePolicyDtoSchema.safeParse(update({ [field.key]: String(field.min - 1) })).success).toBe(false);
    expect(UpdateModelRuntimePolicyDtoSchema.safeParse(update({ [field.key]: String(field.max + 1) })).success).toBe(false);
    expect(UpdateModelRuntimePolicyDtoSchema.safeParse(update({ [field.key]: String(field.min) })).success).toBe(true);
    expect(UpdateModelRuntimePolicyDtoSchema.safeParse(update({ [field.key]: String(field.max) })).success).toBe(true);
  });

  it('accepts upstream defaults and finite defaults with the platform ceiling disabled', () => {
    expect(ModelRuntimePolicyRawValuesSchema.safeParse(defaults()).success).toBe(true);
    expect(ModelRuntimePolicyRawValuesSchema.safeParse({ ...defaults(), GATEWAY_DEFAULT_MAX_TOKENS: '65536',
      WEB_DEFAULT_MAX_OUTPUT_TOKENS: '65536', PLANNER_MAX_OUTPUT_TOKENS: '65536' }).success).toBe(true);
  });

  it('accepts empty override resets, trims reasons and validates history/restore payloads', () => {
    expect(UpdateModelRuntimePolicyDtoSchema.parse(update({ GATEWAY_MEMBER_RPM: '  ' }))).toEqual({
      expectedVersion: 0, updates: { GATEWAY_MEMBER_RPM: '' }, reason: 'capacity review',
    });
    expect(ModelRuntimePolicyHistoryQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(ModelRuntimePolicyHistoryQuerySchema.parse({ limit: '100', cursor: 'history-1' })).toEqual({ limit: 100, cursor: 'history-1' });
    expect(RestoreModelRuntimePolicyDtoSchema.safeParse({ expectedVersion: 2, historyId: 'history-1', side: 'before', reason: 'rollback' }).success).toBe(true);
    expect(RestoreModelRuntimePolicyDtoSchema.safeParse({ expectedVersion: 2, historyId: 'history-1', side: 'unknown', reason: 'rollback' }).success).toBe(false);
  });

  it.each(['SUB2API_API_KEY', MODEL_RUNTIME_POLICY_REVISION, 'MODEL_RESPONSE_TIMEOUT', 'MAX_CONCURRENT_SESSIONS', 'MAX_TOKENS_PER_CONVERSATION', '__proto__', 'unknown'])('rejects non-policy key %s', (key) => {
    expect(UpdateModelRuntimePolicyDtoSchema.safeParse(update({ [key]: '10' })).success).toBe(false);
  });

  it.each([
    { updates: {} }, { expectedVersion: -1 }, { expectedVersion: 1.5 },
    { reason: '' }, { reason: '   ' }, { reason: 'x'.repeat(501) },
    { updates: { GATEWAY_MEMBER_RPM: '1'.repeat(65) } },
    { updates: { GATEWAY_MEMBER_RPM: 120 } }, { bypass: true },
  ])('rejects malformed update %p', (changes) => {
    expect(UpdateModelRuntimePolicyDtoSchema.safeParse({ ...update({ GATEWAY_MEMBER_RPM: '120' }), ...changes }).success).toBe(false);
  });

  it.each([{ limit: 0 }, { limit: 101 }, { limit: 2.5 }, { cursor: '' }, { unknown: 1 }])('rejects malformed pagination %p', (query) => {
    expect(ModelRuntimePolicyHistoryQuerySchema.safeParse(query).success).toBe(false);
  });
});
