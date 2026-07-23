import { z } from 'zod';

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

// Digital Employee Creation
export const DigitalEmployeeCreateDtoSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().min(10).max(2000),
  industry: z.string(),
  position: z.string(),
  systemPrompt: z.string().min(50),
  modelId: z.string().default('gpt-4o'),
  maxSteps: z.number().min(1).max(20).default(10),
  price: z.number().min(0).optional(),
  capabilityIds: z.array(z.string()),
});

export type DigitalEmployeeCreateDto = z.infer<typeof DigitalEmployeeCreateDtoSchema>;

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

export const MessageSendDtoSchema = z.object({
  content: z.string().min(1),
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
