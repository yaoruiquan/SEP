import {
  MODEL_RUNTIME_POLICY_KEYS,
  MODEL_RUNTIME_POLICY_LEGACY_KEYS,
  MODEL_RUNTIME_POLICY_REVISION,
  ModelRuntimePolicyValuesSchema,
  type ModelRuntimePolicyAdminView,
  type ModelRuntimePolicyFieldView,
  type ModelRuntimePolicyKey,
} from '../../../../../../backend/src/shared/model-runtime-policy';

export const BUDGET_KEY: ModelRuntimePolicyKey = 'GATEWAY_ENTERPRISE_TOKEN_BUDGET';

export function isDedicatedPolicySetting(key: string) {
  return key === MODEL_RUNTIME_POLICY_REVISION || (MODEL_RUNTIME_POLICY_KEYS as readonly string[]).includes(key);
}

export function isLegacyPolicySetting(key: string) {
  return (MODEL_RUNTIME_POLICY_LEGACY_KEYS as readonly string[]).includes(key);
}

export const policySourceLabel = (source: string) =>
  ({ database: '数据库覆盖', environment: '环境变量', default: '系统默认' })[source] ?? source;

export const policyUnitLabel = (unit: string) => ({
  seconds: '秒', requests: '次业务请求', 'requests/minute': '次业务请求/分钟',
  'requests-active': '个活跃业务请求', tokens: '输出 Token', 'reservation/minute': '预留单位/分钟',
})[unit] ?? unit;

export function displayPolicyValue(field: ModelRuntimePolicyFieldView, raw: number | string | null) {
  if (raw === null || raw === '') return '未配置';
  return `${Number(raw) / field.displayScale} ${policyUnitLabel(field.displayUnit)}`;
}

export interface PolicyDraft {
  values: Partial<Record<ModelRuntimePolicyKey, string>>;
  budgetEnabled: boolean;
  budgetMode: 'inherit' | 'override';
}

export function createPolicyDraft(view: ModelRuntimePolicyAdminView): PolicyDraft {
  const budget = view.fields.find((field) => field.key === BUDGET_KEY);
  return {
    values: Object.fromEntries(view.fields.map((field) => [field.key,
      field.key === BUDGET_KEY
        ? (field.effectiveValue && field.effectiveValue > 0 ? String(field.effectiveValue) : '')
        : (field.value === '' ? '' : String(Number(field.value) / field.displayScale)),
    ])),
    budgetEnabled: (budget?.effectiveValue ?? 0) > 0,
    budgetMode: budget?.value ? 'override' : 'inherit',
  };
}

export function buildPolicyUpdates(view: ModelRuntimePolicyAdminView, draft: PolicyDraft) {
  const updates: Partial<Record<ModelRuntimePolicyKey, string>> = {};
  const errors: string[] = [];
  for (const field of view.fields) {
    if (!field.editable) continue;
    const input = (draft.values[field.key] ?? '').trim();
    if (field.key !== BUDGET_KEY && input === (field.value === '' ? '' : String(Number(field.value) / field.displayScale))) continue;
    let raw = '';
    if (field.key === BUDGET_KEY && draft.budgetMode === 'inherit') raw = '';
    else if (field.key === BUDGET_KEY && !draft.budgetEnabled) raw = '0';
    else if (input !== '') {
      const value = Number(input) * field.displayScale;
      if (!/^\d+$/.test(input) || !Number.isSafeInteger(value) || value < field.min || value > field.max || (field.key === BUDGET_KEY && value === 0)) {
        errors.push(`${field.label}：请输入范围内的正整数${field.displayUnit === 'seconds' ? '秒' : ''}`);
        continue;
      }
      raw = String(value);
    } else if (field.key === BUDGET_KEY && draft.budgetEnabled) {
      errors.push(`${field.label}：开启预算时必须填写正整数`);
      continue;
    }
    if (raw !== field.value) updates[field.key] = raw;
  }
  // Clearing an override needs the server's deployment fallback, not the old effective value.
  if (view.effectivePolicy && !Object.values(updates).includes('') && errors.length === 0) {
    const candidate = { ...view.effectivePolicy };
    for (const key of MODEL_RUNTIME_POLICY_KEYS) if (updates[key] !== undefined) candidate[key] = Number(updates[key]);
    const result = ModelRuntimePolicyValuesSchema.safeParse(candidate);
    if (!result.success) errors.push(...result.error.issues.map((issue) => issue.message));
  }
  return { updates, errors };
}

export function rebasePolicyDraft(previous: ModelRuntimePolicyAdminView, next: ModelRuntimePolicyAdminView, draft: PolicyDraft): PolicyDraft {
  const original = createPolicyDraft(previous);
  const rebased = createPolicyDraft(next);
  for (const field of previous.fields) {
    if (field.key !== BUDGET_KEY && draft.values[field.key] !== original.values[field.key]) {
      rebased.values[field.key] = draft.values[field.key];
    }
  }
  if (draft.values[BUDGET_KEY] !== original.values[BUDGET_KEY] || draft.budgetEnabled !== original.budgetEnabled || draft.budgetMode !== original.budgetMode) {
    rebased.values[BUDGET_KEY] = draft.values[BUDGET_KEY];
    rebased.budgetEnabled = draft.budgetEnabled;
    rebased.budgetMode = draft.budgetMode;
  }
  return rebased;
}

export function policyImpact(key: ModelRuntimePolicyKey) {
  if (key.startsWith('PLANNER_')) return '任务规划';
  if (key.startsWith('WEB_') || key === 'SUB2API_STREAM_IDLE_TIMEOUT_MS') return 'Web 对话';
  if (key.startsWith('GATEWAY_STREAM_') || key === 'GATEWAY_NON_STREAM_TIMEOUT_MS' || key.startsWith('GATEWAY_MODEL_RATE_') || key === 'GATEWAY_DEFAULT_MAX_TOKENS') return '客户端';
  return '客户端、Web 对话、任务规划';
}
