// Mirror of backend MODEL_CATALOG (backend/src/shared/index.ts).
// 所有 ID 均已在 sub2api 上游 (GET /v1/models) 确认可用。
// 两处需保持同步 —— 改动时同时更新后端 shared/index.ts。

export interface ModelCatalogEntry {
  id: string;
  label: string;
  provider: string;
}

export const MODEL_CATALOG: ModelCatalogEntry[] = [
  { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', provider: 'deepseek' },
  { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', provider: 'deepseek' },
  { id: 'gemini-3.5-flash-high', label: 'Gemini 3.5 Flash High', provider: 'google' },
  { id: 'gpt-4o', label: 'GPT-4o', provider: 'openai' },
  { id: 'gpt-4o-mini', label: 'GPT-4o Mini', provider: 'openai' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', provider: 'anthropic' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', provider: 'anthropic' },
];

/** 系统默认模型（与后端 SUB2API_DEFAULT_MODEL 保持一致）。 */
export const DEFAULT_MODEL_ID = 'deepseek-v4-flash';
