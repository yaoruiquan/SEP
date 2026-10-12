import { MODEL_RUNTIME_POLICY_FIELDS } from 'shared';
import type { ModelRuntimePolicySnapshot } from 'shared';

export function policySnapshot(overrides: Partial<ModelRuntimePolicySnapshot['values']> = {}, version = 7): ModelRuntimePolicySnapshot {
  return Object.freeze({ version, values: Object.freeze({
    ...Object.fromEntries(MODEL_RUNTIME_POLICY_FIELDS.map(field => [field.key, Number(field.defaultValue)])), ...overrides,
  }) as ModelRuntimePolicySnapshot['values'] });
}
