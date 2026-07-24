import { z } from 'zod';

// ============================================================================
// Model Catalog (sub2api 上游可用模型)
// ----------------------------------------------------------------------------
// 所有 ID 均已通过 GET /v1/models 在 sub2api 确认可用。
// 切勿随手填写未验证的 ID（例如 deepseek-chat 在上游不存在，会 model_not_found）。
// 完整调研见 docs/research/sub2api用量追踪与计费对接调研.md
// 前端镜像见 web/src/lib/models.ts —— 两处需保持同步。
// ============================================================================

export interface ModelCatalogEntry {
  id: string;
  label: string;
  provider: string;
}

export const MODEL_CATALOG: readonly ModelCatalogEntry[] = [
  { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', provider: 'deepseek' },
  { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', provider: 'deepseek' },
  { id: 'gemini-3.5-flash-high', label: 'Gemini 3.5 Flash High', provider: 'google' },
  { id: 'gpt-4o', label: 'GPT-4o', provider: 'openai' },
  { id: 'gpt-4o-mini', label: 'GPT-4o Mini', provider: 'openai' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', provider: 'anthropic' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', provider: 'anthropic' },
] as const;

/** 系统默认模型（与 .env 的 SUB2API_DEFAULT_MODEL 保持一致）。 */
export const DEFAULT_MODEL_ID = 'deepseek-v4-flash';

/** 校验模型 ID 是否在目录内。 */
export function isKnownModelId(id: string): boolean {
  return MODEL_CATALOG.some((m) => m.id === id);
}

// ============================================================================
// Capability Result (统一返回格式)
// ============================================================================

export const CapabilityResultSchema = z.object({
  success: z.boolean(),
  data: z.any(),
  error: z.string().optional(),
  metadata: z.object({
    duration: z.number(),      // 执行耗时（ms）
    tokensUsed: z.number().optional(), // Token 消耗
  }).optional(),
});

export type CapabilityResult = z.infer<typeof CapabilityResultSchema>;

// ============================================================================
// Capability Interface (统一执行接口)
// ============================================================================

export interface Capability {
  id: string;
  name: string;
  type: 'agent' | 'rpa' | 'skill' | 'ai-app';
  description: string;
  industry: string[];
  position: string[];
  inputSchema: Record<string, any>;  // JSON Schema
  outputSchema: Record<string, any>; // JSON Schema

  // 统一执行接口
  execute(params: Record<string, any>): Promise<CapabilityResult>;
}

// ============================================================================
// Agent Runtime Types
// ============================================================================

export interface DigitalEmployeeConfig {
  id: string;
  name: string;
  systemPrompt: string;
  modelId: string;
  maxSteps: number;
  capabilities: Capability[];
}

export interface ChatRequest {
  message: string;
  sessionId: string;
  employeeId: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  createdAt: Date;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
  result?: any;
}

// ============================================================================
// API DTOs
// ============================================================================

// Auth
export const RegisterDtoSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().optional(),
});

export type RegisterDto = z.infer<typeof RegisterDtoSchema>;

export const LoginDtoSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export type LoginDto = z.infer<typeof LoginDtoSchema>;

export interface AuthResponse {
  token: string;
  user: {
    id: string;
    email: string;
    name: string | null;
    role: string;
  };
}

// Capability Upload
export const CapabilityUploadDtoSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().min(10).max(2000),
  type: z.enum(['agent', 'rpa', 'skill', 'ai-app']),
  industry: z.array(z.string()),
  position: z.array(z.string()),
  inputSchema: z.record(z.any()),
  outputSchema: z.record(z.any()),

  // Type-specific configs (conditional based on type)
  agentConfig: z.object({
    platform: z.enum(['coze', 'dify', 'n8n', 'opencode']),
    botId: z.string().optional(),
    apiKey: z.string().optional(),
    workflowUrl: z.string().url().optional(),
    skillName: z.string().optional(),
  }).optional(),

  rpaConfig: z.object({
    platform: z.enum(['shizai', 'yingdao']),
    executionMode: z.enum(['download', 'cloud', 'client']),
    packageUrl: z.string().url().optional(),
    configDoc: z.string().optional(),
  }).optional(),

  skillConfig: z.object({
    template: z.string(),
    modelId: z.string().optional(),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().min(1).max(100000).optional(),
  }).optional(),

  aiAppConfig: z.object({
    integrationMode: z.enum(['api', 'iframe', 'redirect']),
    apiUrl: z.string().url().optional(),
    webUrl: z.string().url().optional(),
  }).optional(),
});

export type CapabilityUploadDto = z.infer<typeof CapabilityUploadDtoSchema>;

// Digital Employee
export const DigitalEmployeeCreateDtoSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().min(10).max(2000),
  industry: z.string(),
  position: z.string(),
  avatar: z.string().url().optional(),
  systemPrompt: z.string().min(10),
  modelId: z.string().default(DEFAULT_MODEL_ID),
  maxSteps: z.number().min(1).max(20).default(10),
  price: z.number().min(0).optional(),
  // 初始绑定的已审核 Capability ID 列表（可为空）
  capabilityIds: z.array(z.string()).default([]),
});

export type DigitalEmployeeCreateDto = z.infer<typeof DigitalEmployeeCreateDtoSchema>;

export const DigitalEmployeeUpdateDtoSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().min(10).max(2000).optional(),
  industry: z.string().optional(),
  position: z.string().optional(),
  avatar: z.string().url().optional(),
  systemPrompt: z.string().min(10).optional(),
  modelId: z.string().optional(),
  maxSteps: z.number().min(1).max(20).optional(),
  price: z.number().min(0).optional(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional(),
});

export type DigitalEmployeeUpdateDto = z.infer<typeof DigitalEmployeeUpdateDtoSchema>;

export const BindCapabilityDtoSchema = z.object({
  capabilityId: z.string().min(1),
  order: z.number().int().min(0).optional(),
});

export type BindCapabilityDto = z.infer<typeof BindCapabilityDtoSchema>;

// Subscription
export const SubscriptionCreateDtoSchema = z.object({
  employeeId: z.string(),
  config: z.record(z.any()).optional(),
});

export type SubscriptionCreateDto = z.infer<typeof SubscriptionCreateDtoSchema>;

// Conversation
export const ConversationCreateDtoSchema = z.object({
  employeeId: z.string(),
  title: z.string().optional(),
});

export type ConversationCreateDto = z.infer<typeof ConversationCreateDtoSchema>;

export const ConversationUpdateDtoSchema = z.object({
  title: z.string().min(1).max(100),
});

export type ConversationUpdateDto = z.infer<typeof ConversationUpdateDtoSchema>;

export const MessageSendDtoSchema = z.object({
  content: z.string().min(1).max(10000),
});

export type MessageSendDto = z.infer<typeof MessageSendDtoSchema>;

// User Profile
export const UpdateProfileDtoSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  avatar: z.string().url().optional(),
});

export type UpdateProfileDto = z.infer<typeof UpdateProfileDtoSchema>;

export const ChangePasswordDtoSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

export type ChangePasswordDto = z.infer<typeof ChangePasswordDtoSchema>;

export interface UserProfileResponse {
  id: string;
  email: string;
  name: string | null;
  avatar: string | null;
  role: string;
  createdAt: Date;
  updatedAt: Date;
}
