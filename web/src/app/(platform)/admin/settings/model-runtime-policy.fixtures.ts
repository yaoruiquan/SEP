import {
  MODEL_RUNTIME_POLICY_FIELDS,
  type ModelRuntimePolicyAdminView,
  type ModelRuntimePolicyHistoryItem,
  type ModelRuntimePolicyKey,
} from '../../../../../../backend/src/shared/model-runtime-policy';

export function policyFixture(version = 1, overrides: Partial<Record<ModelRuntimePolicyKey, string>> = {}): ModelRuntimePolicyAdminView {
  const fields = MODEL_RUNTIME_POLICY_FIELDS.map((field) => ({
    ...field,
    value: overrides[field.key] ?? '',
    effectiveValue: Number(overrides[field.key] || field.defaultValue),
    source: overrides[field.key] ? 'database' as const : 'default' as const,
  }));
  return {
    version, fields,
    effectivePolicy: Object.fromEntries(fields.map((field) => [field.key, field.effectiveValue])) as Record<ModelRuntimePolicyKey, number>,
    warnings: [], errors: [], writeEnabled: true,
    preflight: {
      environmentFingerprint: 'test', expectedEnvironmentFingerprint: 'test',
      environmentValid: true, fingerprintMatches: true, writesConfigured: true,
      legacyOverrides: [], deploymentVerification: 'required',
    },
  };
}

export function historyFixture(): ModelRuntimePolicyHistoryItem {
  const before = policyFixture(0);
  const after = policyFixture(1, { GATEWAY_STREAM_HEADER_TIMEOUT_MS: '90000' });
  const state = (view: ModelRuntimePolicyAdminView) => ({
    version: view.version,
    overrides: Object.fromEntries(view.fields.map((field) => [field.key, field.value || null])) as Record<ModelRuntimePolicyKey, string | null>,
    effectivePolicy: view.effectivePolicy!,
    sources: Object.fromEntries(view.fields.map((field) => [field.key, field.source])) as Record<ModelRuntimePolicyKey, 'database' | 'environment' | 'default'>,
  });
  return { id: 'history-1', actorId: 'admin-1', createdAt: '2026-10-12T01:00:00Z', reason: '容量核验', before: state(before), after: state(after) };
}
