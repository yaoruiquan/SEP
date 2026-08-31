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
  /** 本次执行实际用的技能版本，由 CapabilityService 回填供审计落库 */
  skillVersionId?: string | null;
}

// 来自 AgentConfig 表的配置
export interface AdapterConfig {
  platform: string;
  botId?: string | null;       // Coze Bot ID
  apiKey?: string | null;      // Coze PAT / Dify API Key
  workflowUrl?: string | null; // N8N Webhook URL
  skillName?: string | null;   // OpenCode skill name

  /**
   * 本次执行实际生效的 SKILL 正文（企业私有版本或平台版本）。
   *
   * 存在的理由：企业可以在本企业范围内编辑技能，编辑后的版本必须真正参与执行。
   * 只传 skillName 的话，执行端拿到的永远是它自己那份静态模板 —— 企业的编辑与
   * 采纳就成了纯账面动作（改完、审完、"生效"了，但对话输出一点没变）。
   */
  skillContent?: string | null;
  /** 上面那份正文来自哪个 SkillVersion，用于把产出归因到具体版本 */
  skillVersionId?: string | null;
}

/**
 * 执行上下文：决定「用哪个版本」需要知道「谁在用」。
 *
 * 版本解析顺序（见 SkillVersionService.resolveEffectiveVersion）：
 *   企业选版 → 员工模板默认版 → 最新平台审核通过版
 * 没有 subscriptionId 就只能落到最后一档，所以调用方必须传。
 */
export interface CapabilityExecutionContext {
  /** 雇佣关系 ID。有它才能解析出企业选定的版本 */
  subscriptionId?: string;
}

export interface CapabilityAdapter {
  execute(input: AdapterInput): Promise<AdapterExecutionResult>;
}
