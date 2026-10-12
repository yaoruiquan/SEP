import { z } from 'zod';

export const MODEL_RUNTIME_POLICY_KEYS = [
  'GATEWAY_STREAM_HEADER_TIMEOUT_MS',
  'GATEWAY_STREAM_IDLE_TIMEOUT_MS',
  'GATEWAY_STREAM_TOTAL_TIMEOUT_MS',
  'GATEWAY_NON_STREAM_TIMEOUT_MS',
  'SUB2API_STREAM_IDLE_TIMEOUT_MS',
  'WEB_MODEL_TOTAL_TIMEOUT_MS',
  'PLANNER_REQUEST_TIMEOUT_MS',
  'GATEWAY_MODEL_RATE_LIMIT',
  'GATEWAY_MODEL_RATE_WINDOW_MS',
  'GATEWAY_MEMBER_RPM',
  'GATEWAY_ENTERPRISE_RPM',
  'GATEWAY_MEMBER_CONCURRENCY',
  'GATEWAY_ENTERPRISE_CONCURRENCY',
  'GATEWAY_DEFAULT_MAX_TOKENS',
  'WEB_DEFAULT_MAX_OUTPUT_TOKENS',
  'PLANNER_MAX_OUTPUT_TOKENS',
  'MODEL_MAX_OUTPUT_TOKENS',
  'GATEWAY_ENTERPRISE_TOKEN_BUDGET',
] as const;

export type ModelRuntimePolicyKey = (typeof MODEL_RUNTIME_POLICY_KEYS)[number];
export const MODEL_RUNTIME_POLICY_REVISION = 'MODEL_RUNTIME_POLICY_REVISION';
export const MODEL_RUNTIME_POLICY_AUDIT_ACTION = 'MODEL_RUNTIME_POLICY_UPDATED';
export const MODEL_RUNTIME_POLICY_LEGACY_KEYS = [
  'MODEL_RESPONSE_TIMEOUT', 'MAX_CONCURRENT_SESSIONS', 'MAX_TOKENS_PER_CONVERSATION',
] as const;
export type ModelRuntimePolicySource = 'database' | 'environment' | 'default';

export interface ModelRuntimePolicySnapshot {
  readonly version: number;
  readonly values: Readonly<Record<ModelRuntimePolicyKey, number>>;
}

export interface ModelRuntimePolicyFieldMeta {
  key: ModelRuntimePolicyKey;
  label: string;
  group: 'client-timeouts' | 'web-planner-timeouts' | 'rates-concurrency' | 'output-budget';
  description: string;
  unit: 'ms' | 'requests' | 'requests/minute' | 'requests-active' | 'tokens' | 'reservation/minute';
  displayUnit: 'seconds' | 'requests' | 'requests/minute' | 'requests-active' | 'tokens' | 'reservation/minute';
  displayScale: number;
  min: number;
  max: number;
  defaultValue: string;
  editable: boolean;
  applyMode: 'new-requests' | 'next-window';
}

function field(
  key: ModelRuntimePolicyKey, label: string, group: ModelRuntimePolicyFieldMeta['group'],
  defaultValue: number, min: number, max: number, unit: ModelRuntimePolicyFieldMeta['unit'],
  description: string, applyMode: ModelRuntimePolicyFieldMeta['applyMode'] = 'new-requests',
): ModelRuntimePolicyFieldMeta {
  return {
    key, label, group, defaultValue: String(defaultValue), min, max, unit, description, applyMode,
    displayUnit: unit === 'ms' ? 'seconds' : unit, displayScale: unit === 'ms' ? 1000 : 1, editable: true,
  };
}

export const MODEL_RUNTIME_POLICY_FIELDS: readonly ModelRuntimePolicyFieldMeta[] = [
  field('GATEWAY_STREAM_HEADER_TIMEOUT_MS', '客户端：等待响应头', 'client-timeouts', 120000, 1000, 120000, 'ms', '上游调用开始至响应头返回。'),
  field('GATEWAY_STREAM_IDLE_TIMEOUT_MS', '客户端：流连续空闲', 'client-timeouts', 120000, 1000, 120000, 'ms', '等待上游非空字节的连续时长；背压暂停不计空闲。'),
  field('GATEWAY_STREAM_TOTAL_TIMEOUT_MS', '客户端：流总时长', 'client-timeouts', 600000, 1000, 600000, 'ms', '从上游调用开始至响应读取完成，包括背压等待。'),
  field('GATEWAY_NON_STREAM_TIMEOUT_MS', '客户端：非流式总时长', 'client-timeouts', 120000, 1000, 120000, 'ms', '包括响应头和完整响应体读取。'),
  field('SUB2API_STREAM_IDLE_TIMEOUT_MS', 'Web：每轮模型流空闲', 'web-planner-timeouts', 45000, 1000, 120000, 'ms', '每轮模型流的有效事件等待，不按浏览器心跳重置。'),
  field('WEB_MODEL_TOTAL_TIMEOUT_MS', 'Web：本次模型处理总时长', 'web-planner-timeouts', 600000, 1000, 600000, 'ms', '涵盖准入后的准备、模型和工具循环，不按步骤重置。'),
  field('PLANNER_REQUEST_TIMEOUT_MS', '任务规划：模型请求总时长', 'web-planner-timeouts', 120000, 1000, 120000, 'ms', '涵盖规划上游 fetch 及完整响应体读取。'),
  field('GATEWAY_MODEL_RATE_LIMIT', '客户端订阅组合业务请求次数', 'rates-concurrency', 60, 1, 10000, 'requests', '企业、成员和订阅组合的固定窗口请求数。'),
  field('GATEWAY_MODEL_RATE_WINDOW_MS', '客户端订阅组合计数窗口', 'rates-concurrency', 60000, 1000, 60000, 'ms', '已有窗口维持原到期时间，下个窗口才采用新长度。', 'next-window'),
  field('GATEWAY_MEMBER_RPM', '成员业务请求次数', 'rates-concurrency', 120, 1, 10000, 'requests/minute', '客户端、Web 和规划合计；不是上游 HTTP 尝试次数。'),
  field('GATEWAY_ENTERPRISE_RPM', '企业业务请求次数', 'rates-concurrency', 600, 1, 100000, 'requests/minute', '同一企业的客户端、Web 和规划合计。'),
  field('GATEWAY_MEMBER_CONCURRENCY', '成员活跃业务请求并发', 'rates-concurrency', 4, 1, 32, 'requests-active', '覆盖完整业务生命周期，Web 工具步骤不重复占位。'),
  field('GATEWAY_ENTERPRISE_CONCURRENCY', '企业活跃业务请求并发', 'rates-concurrency', 32, 1, 256, 'requests-active', '降低限制不终止在途请求。'),
  field('GATEWAY_DEFAULT_MAX_TOKENS', '客户端默认输出数量', 'output-budget', 4096, 1, 1048576, 'tokens', '未指定输出数量时，与模型有效上限取较小值。'),
  field('WEB_DEFAULT_MAX_OUTPUT_TOKENS', 'Web 默认输出数量', 'output-budget', 4096, 1, 1048576, 'tokens', '每轮模型输出数量，不是整场对话累计限制。'),
  field('PLANNER_MAX_OUTPUT_TOKENS', '任务规划输出数量', 'output-budget', 4000, 1, 1048576, 'tokens', '规划单次模型请求的输出数量。'),
  field('MODEL_MAX_OUTPUT_TOKENS', '平台单次输出上限', 'output-budget', 32768, 1, 1048576, 'tokens', '与已知模型输出能力取较小值，不是上下文长度。'),
  field('GATEWAY_ENTERPRISE_TOKEN_BUDGET', '企业每分钟保守资源预留预算', 'output-budget', 0, 0, 1000000000, 'reservation/minute', '0 关闭；请求 UTF-8 字节数加最大输出数量的估算，不是实耗或计费 Token。'),
];

const valueShape = Object.fromEntries(MODEL_RUNTIME_POLICY_FIELDS.map((meta) => [
  meta.key, z.number().int().min(meta.min).max(meta.max),
])) as Record<ModelRuntimePolicyKey, z.ZodNumber>;

export const ModelRuntimePolicyValuesSchema = z.object(valueShape).strict().superRefine((values, ctx) => {
  const atLeast = (larger: ModelRuntimePolicyKey, smaller: ModelRuntimePolicyKey) => {
    if (values[larger] < values[smaller]) ctx.addIssue({
      code: z.ZodIssueCode.custom, path: [larger], message: `${larger} 不得小于 ${smaller}`,
    });
  };
  atLeast('GATEWAY_STREAM_TOTAL_TIMEOUT_MS', 'GATEWAY_STREAM_HEADER_TIMEOUT_MS');
  atLeast('GATEWAY_STREAM_TOTAL_TIMEOUT_MS', 'GATEWAY_STREAM_IDLE_TIMEOUT_MS');
  atLeast('WEB_MODEL_TOTAL_TIMEOUT_MS', 'SUB2API_STREAM_IDLE_TIMEOUT_MS');
  atLeast('GATEWAY_ENTERPRISE_RPM', 'GATEWAY_MEMBER_RPM');
  atLeast('GATEWAY_ENTERPRISE_CONCURRENCY', 'GATEWAY_MEMBER_CONCURRENCY');
  atLeast('MODEL_MAX_OUTPUT_TOKENS', 'GATEWAY_DEFAULT_MAX_TOKENS');
  atLeast('MODEL_MAX_OUTPUT_TOKENS', 'WEB_DEFAULT_MAX_OUTPUT_TOKENS');
  atLeast('MODEL_MAX_OUTPUT_TOKENS', 'PLANNER_MAX_OUTPUT_TOKENS');
}) as z.ZodType<Record<ModelRuntimePolicyKey, number>>;

// Empty strings remove overrides; reject Number('') and non-decimal coercion.
export const ModelRuntimePolicyRawValuesSchema = z.preprocess((input) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [
    key, typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value.trim()) : value,
  ]));
}, ModelRuntimePolicyValuesSchema);

const reason = z.string().trim().min(1).max(500);
const version = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1);
export const UpdateModelRuntimePolicyDtoSchema = z.object({
  expectedVersion: version,
  updates: z.record(z.enum(MODEL_RUNTIME_POLICY_KEYS), z.string().max(64).trim()).superRefine((updates, ctx) => {
    if (Object.keys(updates).length === 0 || Object.keys(updates).length > MODEL_RUNTIME_POLICY_KEYS.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '必须提交 1 至 18 个策略字段' });
    }
    for (const [key, raw] of Object.entries(updates)) {
      if (raw === '') continue;
      if (!/^\d+$/.test(raw) || !valueShape[key as ModelRuntimePolicyKey].safeParse(Number(raw)).success) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `${key} 必须是范围内的十进制整数` });
      }
    }
  }),
  reason,
}).strict();
export type UpdateModelRuntimePolicyDto = z.infer<typeof UpdateModelRuntimePolicyDtoSchema>;

export const RestoreModelRuntimePolicyDtoSchema = z.object({
  expectedVersion: version, historyId: z.string().trim().min(1).max(128),
  side: z.enum(['before', 'after']), reason,
}).strict();
export type RestoreModelRuntimePolicyDto = z.infer<typeof RestoreModelRuntimePolicyDtoSchema>;

export const ModelRuntimePolicyHistoryQuerySchema = z.object({
  cursor: z.string().trim().min(1).max(128).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict();
export type ModelRuntimePolicyHistoryQuery = z.infer<typeof ModelRuntimePolicyHistoryQuerySchema>;

export interface ModelRuntimePolicyFieldView extends ModelRuntimePolicyFieldMeta {
  value: string;
  effectiveValue: number | null;
  source: ModelRuntimePolicySource;
}
export interface ModelRuntimePolicyIssue { key?: ModelRuntimePolicyKey; message: string }
export interface ModelRuntimePolicyPreflight {
  environmentFingerprint: string;
  expectedEnvironmentFingerprint: string | null;
  environmentValid: boolean;
  fingerprintMatches: boolean;
  writesConfigured: boolean;
  legacyOverrides: string[];
  deploymentVerification: 'required';
}
export interface ModelRuntimePolicyAdminView {
  version: number;
  fields: ModelRuntimePolicyFieldView[];
  effectivePolicy: ModelRuntimePolicySnapshot['values'] | null;
  warnings: string[];
  errors: ModelRuntimePolicyIssue[];
  writeEnabled: boolean;
  preflight: ModelRuntimePolicyPreflight;
}
export interface ModelRuntimePolicyAuditState {
  version: number;
  overrides: Record<ModelRuntimePolicyKey, string | null>;
  effectivePolicy: Record<ModelRuntimePolicyKey, number>;
  sources: Record<ModelRuntimePolicyKey, ModelRuntimePolicySource>;
}
export interface ModelRuntimePolicyHistoryItem {
  id: string;
  actorId: string;
  createdAt: string;
  reason: string;
  before: ModelRuntimePolicyAuditState;
  after: ModelRuntimePolicyAuditState;
  restoredFrom?: { historyId: string; side: 'before' | 'after' };
}
export interface ModelRuntimePolicyHistoryPage {
  items: ModelRuntimePolicyHistoryItem[];
  nextCursor: string | null;
}
export interface ModelRuntimePolicyChange {
  key: ModelRuntimePolicyKey;
  before: string | null;
  after: string | null;
  beforeEffectiveValue: number;
  afterEffectiveValue: number;
}
export interface ModelRuntimePolicyWriteResult extends ModelRuntimePolicyAdminView {
  changes: ModelRuntimePolicyChange[];
  message: string;
}
