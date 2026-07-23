// 适配器统一接口 — 所有硅基能力平台都实现这个接口

export interface AdapterInput {
  userMessage: string;
  sessionId: string;
  userId?: string;
  extraParams?: Record<string, any>;  // 平台特定扩展参数
}

export interface AdapterExecutionResult {
  success: boolean;
  output: string;          // 主文本输出
  durationMs: number;
  rawResponse?: unknown;   // 原始响应（调试用）
  error?: string;
}

// 来自 AgentConfig 表的配置
export interface AdapterConfig {
  platform: string;
  botId?: string | null;       // Coze Bot ID
  apiKey?: string | null;      // Coze PAT / Dify API Key
  workflowUrl?: string | null; // N8N Webhook URL
  skillName?: string | null;   // OpenCode skill name
}

export interface CapabilityAdapter {
  execute(input: AdapterInput): Promise<AdapterExecutionResult>;
}
