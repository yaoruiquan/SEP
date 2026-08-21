import { z } from "zod";

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
  { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash", provider: "deepseek" },
  { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", provider: "deepseek" },
  {
    id: "gemini-3.5-flash-high",
    label: "Gemini 3.5 Flash High",
    provider: "google",
  },
  { id: "gpt-4o", label: "GPT-4o", provider: "openai" },
  { id: "gpt-4o-mini", label: "GPT-4o Mini", provider: "openai" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5", provider: "anthropic" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", provider: "anthropic" },
] as const;

/**
 * 系统默认模型（与 .env 的 SUB2API_DEFAULT_MODEL 保持一致）。
 *
 * 必须选支持 function calling 的模型 —— 员工未指定 modelId 时会落到这里，
 * 若默认模型不支持 tools，所有绑定了能力的员工都会因上游返回
 * 400 Invalid request 而对话失败。已实测：deepseek 系不支持 tools，
 * gemini / claude 系支持。
 */
export const DEFAULT_MODEL_ID = "gemini-3.5-flash-high";

/** 校验模型 ID 是否在目录内。 */
export function isKnownModelId(id: string): boolean {
  return MODEL_CATALOG.some((m) => m.id === id);
}

// ============================================================================
// System Settings (可在管理端配置的运行时设置)
// ----------------------------------------------------------------------------
// 运行时优先读 SystemSetting 表，未配置时回退 .env。
// secret=true 的项加密存储，接口永不回传明文。
// ============================================================================

/**
 * 汇率默认值。真实生效值优先取系统设置（SETTING_KEYS.USD_TO_CNY_RATE），
 * 由调用方通过 calculateCost 的 rate 参数传入；此常量仅作兜底。
 * 汇率会波动，硬编码会导致改一次就要重新构建部署，故做成可配置项。
 */
export const DEFAULT_USD_TO_CNY_RATE = 7.2;

/** @deprecated 用 DEFAULT_USD_TO_CNY_RATE，或从系统设置读取生效值。 */
export const USD_TO_CNY_RATE = DEFAULT_USD_TO_CNY_RATE;

export const SETTING_KEYS = {
  SUB2API_BASE_URL: "SUB2API_BASE_URL",
  SUB2API_API_KEY: "SUB2API_API_KEY",
  SUB2API_DEFAULT_MODEL: "SUB2API_DEFAULT_MODEL",
  /** 美元→人民币汇率。模型单价以 USD 计，计费入账以 CNY 计。 */
  USD_TO_CNY_RATE: "USD_TO_CNY_RATE",
  /** 客户端实例令牌有效期（分钟）。建议初值 15。 */
  CLIENT_TOKEN_TTL_MINUTES: "CLIENT_TOKEN_TTL_MINUTES",
  // 平台基础信息
  PLATFORM_NAME: "PLATFORM_NAME",
  PLATFORM_LOGO_URL: "PLATFORM_LOGO_URL",
  SUPPORT_EMAIL: "SUPPORT_EMAIL",
  SUPPORT_PHONE: "SUPPORT_PHONE",
  ICP_NUMBER: "ICP_NUMBER",
  // 计费配置
  FALLBACK_PRICE_INPUT: "FALLBACK_PRICE_INPUT",
  FALLBACK_PRICE_OUTPUT: "FALLBACK_PRICE_OUTPUT",
  NEW_ENTERPRISE_GIFT_TOKENS: "NEW_ENTERPRISE_GIFT_TOKENS",
  LOW_BALANCE_THRESHOLD: "LOW_BALANCE_THRESHOLD",
  // 安全与限制
  MAX_TOKENS_PER_CONVERSATION: "MAX_TOKENS_PER_CONVERSATION",
  MAX_CONCURRENT_SESSIONS: "MAX_CONCURRENT_SESSIONS",
  ADMIN_IP_WHITELIST: "ADMIN_IP_WHITELIST",
  // 注册与审核
  ENTERPRISE_REGISTRATION_APPROVAL: "ENTERPRISE_REGISTRATION_APPROVAL",
  SEND_WELCOME_EMAIL: "SEND_WELCOME_EMAIL",
  // 内容审核
  CONTENT_FILTER_ENABLED: "CONTENT_FILTER_ENABLED",
  // 数据保留
  CONVERSATION_RETENTION_DAYS: "CONVERSATION_RETENTION_DAYS",
  OPERATION_LOG_RETENTION_DAYS: "OPERATION_LOG_RETENTION_DAYS",
  SOFT_DELETE_RETENTION_DAYS: "SOFT_DELETE_RETENTION_DAYS",
  // 性能与缓存
  REDIS_CACHE_ENABLED: "REDIS_CACHE_ENABLED",
  CONVERSATION_CACHE_TTL: "CONVERSATION_CACHE_TTL",
  MODEL_RESPONSE_TIMEOUT: "MODEL_RESPONSE_TIMEOUT",
  // 通知配置
  ADMIN_NOTIFICATION_EMAIL: "ADMIN_NOTIFICATION_EMAIL",
  ABNORMAL_USAGE_THRESHOLD: "ABNORMAL_USAGE_THRESHOLD",
  SYSTEM_MAINTENANCE_NOTICE: "SYSTEM_MAINTENANCE_NOTICE",
  // 支付宝配置
  ALIPAY_APP_ID: "alipay.appId",
  ALIPAY_PRIVATE_KEY: "alipay.privateKey",
  ALIPAY_PUBLIC_KEY: "alipay.publicKey",
  ALIPAY_GATEWAY: "alipay.gateway",
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

/** 哪些配置项是敏感值（加密存储、接口打码）。 */
export const SECRET_SETTING_KEYS: readonly SettingKey[] = [
  SETTING_KEYS.SUB2API_API_KEY,
  SETTING_KEYS.ALIPAY_PRIVATE_KEY,
];

/** 管理端可编辑的配置项元信息（用于渲染设置表单）。 */
export interface SettingFieldMeta {
  key: SettingKey;
  label: string;
  secret: boolean;
  envFallback: string; // 对应的 .env 变量名（回退用）
  placeholder?: string;
}

export const SETTING_FIELDS: readonly SettingFieldMeta[] = [
  {
    key: SETTING_KEYS.SUB2API_BASE_URL,
    label: "sub2api 上游地址",
    secret: false,
    envFallback: "SUB2API_BASE_URL",
    placeholder: "https://longdaoai.cn/v1",
  },
  {
    key: SETTING_KEYS.SUB2API_API_KEY,
    label: "sub2api API Key",
    secret: true,
    envFallback: "SUB2API_API_KEY",
    placeholder: "sk-...",
  },
  {
    key: SETTING_KEYS.SUB2API_DEFAULT_MODEL,
    label: "默认模型",
    secret: false,
    envFallback: "SUB2API_DEFAULT_MODEL",
    placeholder: DEFAULT_MODEL_ID,
  },
  {
    key: SETTING_KEYS.USD_TO_CNY_RATE,
    label: "美元汇率（USD→CNY）",
    secret: false,
    envFallback: "USD_TO_CNY_RATE",
    placeholder: String(DEFAULT_USD_TO_CNY_RATE),
  },
  {
    key: SETTING_KEYS.CLIENT_TOKEN_TTL_MINUTES,
    label: "客户端实例令牌有效期（分钟）",
    secret: false,
    envFallback: "CLIENT_TOKEN_TTL_MINUTES",
    placeholder: "15",
  },
  // 平台基础信息
  {
    key: SETTING_KEYS.PLATFORM_NAME,
    label: "平台名称",
    secret: false,
    envFallback: "PLATFORM_NAME",
    placeholder: "硅基人才平台",
  },
  {
    key: SETTING_KEYS.PLATFORM_LOGO_URL,
    label: "平台Logo地址",
    secret: false,
    envFallback: "PLATFORM_LOGO_URL",
    placeholder: "",
  },
  {
    key: SETTING_KEYS.SUPPORT_EMAIL,
    label: "客服邮箱",
    secret: false,
    envFallback: "SUPPORT_EMAIL",
    placeholder: "support@example.com",
  },
  {
    key: SETTING_KEYS.SUPPORT_PHONE,
    label: "客服电话",
    secret: false,
    envFallback: "SUPPORT_PHONE",
    placeholder: "",
  },
  {
    key: SETTING_KEYS.ICP_NUMBER,
    label: "备案号",
    secret: false,
    envFallback: "ICP_NUMBER",
    placeholder: "",
  },
  // 计费配置
  {
    key: SETTING_KEYS.FALLBACK_PRICE_INPUT,
    label: "保底计费-输入价格 (元/1K tokens)",
    secret: false,
    envFallback: "FALLBACK_PRICE_INPUT",
    placeholder: "0.001",
  },
  {
    key: SETTING_KEYS.FALLBACK_PRICE_OUTPUT,
    label: "保底计费-输出价格 (元/1K tokens)",
    secret: false,
    envFallback: "FALLBACK_PRICE_OUTPUT",
    placeholder: "0.002",
  },
  {
    key: SETTING_KEYS.NEW_ENTERPRISE_GIFT_TOKENS,
    label: "新企业赠送额度 (tokens)",
    secret: false,
    envFallback: "NEW_ENTERPRISE_GIFT_TOKENS",
    placeholder: "100000",
  },
  {
    key: SETTING_KEYS.LOW_BALANCE_THRESHOLD,
    label: "低余额告警阈值 (tokens)",
    secret: false,
    envFallback: "LOW_BALANCE_THRESHOLD",
    placeholder: "10000",
  },
  // 安全与限制
  {
    key: SETTING_KEYS.MAX_TOKENS_PER_CONVERSATION,
    label: "单次对话最大tokens",
    secret: false,
    envFallback: "MAX_TOKENS_PER_CONVERSATION",
    placeholder: "32000",
  },
  {
    key: SETTING_KEYS.MAX_CONCURRENT_SESSIONS,
    label: "单企业并发会话数 (0=不限制)",
    secret: false,
    envFallback: "MAX_CONCURRENT_SESSIONS",
    placeholder: "10",
  },
  {
    key: SETTING_KEYS.ADMIN_IP_WHITELIST,
    label: "管理员IP白名单 (逗号分隔)",
    secret: false,
    envFallback: "ADMIN_IP_WHITELIST",
    placeholder: "",
  },
  // 注册与审核
  {
    key: SETTING_KEYS.ENTERPRISE_REGISTRATION_APPROVAL,
    label: "企业注册需人工审核",
    secret: false,
    envFallback: "ENTERPRISE_REGISTRATION_APPROVAL",
    placeholder: "true",
  },
  {
    key: SETTING_KEYS.SEND_WELCOME_EMAIL,
    label: "审核通过发送欢迎邮件",
    secret: false,
    envFallback: "SEND_WELCOME_EMAIL",
    placeholder: "false",
  },
  // 内容审核
  {
    key: SETTING_KEYS.CONTENT_FILTER_ENABLED,
    label: "敏感词过滤开关",
    secret: false,
    envFallback: "CONTENT_FILTER_ENABLED",
    placeholder: "false",
  },
  // 数据保留
  {
    key: SETTING_KEYS.CONVERSATION_RETENTION_DAYS,
    label: "对话记录保留天数 (0=永久)",
    secret: false,
    envFallback: "CONVERSATION_RETENTION_DAYS",
    placeholder: "90",
  },
  {
    key: SETTING_KEYS.OPERATION_LOG_RETENTION_DAYS,
    label: "操作日志保留天数 (0=永久)",
    secret: false,
    envFallback: "OPERATION_LOG_RETENTION_DAYS",
    placeholder: "180",
  },
  {
    key: SETTING_KEYS.SOFT_DELETE_RETENTION_DAYS,
    label: "软删除数据保留天数",
    secret: false,
    envFallback: "SOFT_DELETE_RETENTION_DAYS",
    placeholder: "30",
  },
  // 性能与缓存
  {
    key: SETTING_KEYS.REDIS_CACHE_ENABLED,
    label: "Redis缓存开关",
    secret: false,
    envFallback: "REDIS_CACHE_ENABLED",
    placeholder: "true",
  },
  {
    key: SETTING_KEYS.CONVERSATION_CACHE_TTL,
    label: "对话历史缓存时长 (秒)",
    secret: false,
    envFallback: "CONVERSATION_CACHE_TTL",
    placeholder: "3600",
  },
  {
    key: SETTING_KEYS.MODEL_RESPONSE_TIMEOUT,
    label: "模型响应超时 (秒)",
    secret: false,
    envFallback: "MODEL_RESPONSE_TIMEOUT",
    placeholder: "120",
  },
  // 通知配置
  {
    key: SETTING_KEYS.ADMIN_NOTIFICATION_EMAIL,
    label: "管理员通知邮箱",
    secret: false,
    envFallback: "ADMIN_NOTIFICATION_EMAIL",
    placeholder: "admin@example.com",
  },
  {
    key: SETTING_KEYS.ABNORMAL_USAGE_THRESHOLD,
    label: "异常消耗告警阈值 (单小时tokens)",
    secret: false,
    envFallback: "ABNORMAL_USAGE_THRESHOLD",
    placeholder: "100000",
  },
  {
    key: SETTING_KEYS.SYSTEM_MAINTENANCE_NOTICE,
    label: "系统维护公告",
    secret: false,
    envFallback: "SYSTEM_MAINTENANCE_NOTICE",
    placeholder: "",
  },
  // 支付宝配置
  {
    key: SETTING_KEYS.ALIPAY_APP_ID,
    label: "支付宝应用ID",
    secret: false,
    envFallback: "ALIPAY_APP_ID",
    placeholder: "202400012345678",
  },
  {
    key: SETTING_KEYS.ALIPAY_PRIVATE_KEY,
    label: "支付宝应用私钥",
    secret: true,
    envFallback: "ALIPAY_PRIVATE_KEY",
    placeholder: "MIIEvQIBADANBgkqhkiG9w0BAQEFAASC...",
  },
  {
    key: SETTING_KEYS.ALIPAY_PUBLIC_KEY,
    label: "支付宝公钥",
    secret: false,
    envFallback: "ALIPAY_PUBLIC_KEY",
    placeholder: "MIIBIjANBgkqhkiG9w0BAQEFAAOC...",
  },
  {
    key: SETTING_KEYS.ALIPAY_GATEWAY,
    label: "支付宝网关地址",
    secret: false,
    envFallback: "ALIPAY_GATEWAY",
    placeholder: "https://openapi.alipay.com/gateway.do",
  },
];

// ============================================================================
// Capability Result (统一返回格式)
// ============================================================================

export const CapabilityResultSchema = z.object({
  success: z.boolean(),
  data: z.any(),
  error: z.string().optional(),
  metadata: z
    .object({
      duration: z.number(), // 执行耗时（ms）
      tokensUsed: z.number().optional(), // Token 消耗
    })
    .optional(),
});

export type CapabilityResult = z.infer<typeof CapabilityResultSchema>;

// ============================================================================
// Capability Interface (统一执行接口)
// ============================================================================

export interface Capability {
  id: string;
  name: string;
  type: "agent" | "rpa" | "skill" | "ai-app";
  description: string;
  industry: string[];
  position: string[];
  inputSchema: Record<string, any>; // JSON Schema
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
  role: "user" | "assistant" | "tool";
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

/**
 * 邮箱字段的统一定义 —— 所有身份边界都该用它，不要写裸 z.string().email()。
 *
 * 归一化放在 Zod 层而非各 service 里，理由有两条：
 *   ① 邮箱大小写不敏感。若不归一化，"Bob@x.com" 能绕过"该邮箱已是成员"
 *      之类的等值检查，建出同一个人的第二条记录。
 *   ② trim 必须在 email 校验**之前**跑。顺序反了的话，用户在输入框里
 *      多打一个尾随空格，拿到的是"邮箱格式不正确"这种查不出原因的报错。
 */
export const EmailSchema = z.string().trim().toLowerCase().email();

/**
 * 企业自助注册。
 *
 * 注册的不是"个人账号"，而是「公司 + 创建者」一并建立：
 * User + Enterprise + EnterpriseMember(ENTERPRISE_ADMIN) + ComputeAccount。
 *
 * 为什么第一个人必须在注册时就成为管理员：「企业管理员」这个身份无法
 * 自行申请（申请给谁批？），只能来自"这家公司是我开的"。第二个人起
 * 不走注册，由管理员在企业管理台添加 —— 若同事也去点注册，
 * 会创建出第二家公司。
 */
export const RegisterDtoSchema = z.object({
  email: EmailSchema,
  password: z.string().min(8),
  name: z.string().optional(),
  /** 公司名称。注册即创建该企业，注册人成为其首个企业管理员。 */
  enterpriseName: z.string().min(2).max(100),
});

export type RegisterDto = z.infer<typeof RegisterDtoSchema>;

/**
 * 已登录且**无企业归属**的账号开新公司。
 *
 * 为什么不复用 RegisterDto：注册要建 User（需要 email/password），
 * 这里 User 已存在，只缺 Enterprise + Member + ComputeAccount。
 * 让无归属账号带着 email/password 再走一遍注册，等于要求用户
 * 重新提供已有凭据，且会撞上「邮箱已被注册」。
 *
 * 这条路径对应状态机里的 `[无归属] ── 开新公司 ──> [企业管理员]`：
 * 被前公司移除的人不该为了开自己的公司而换一个邮箱。
 */
export const CreateEnterpriseDtoSchema = z.object({
  name: z.string().min(2).max(100),
});
export type CreateEnterpriseDto = z.infer<typeof CreateEnterpriseDtoSchema>;

export const LoginDtoSchema = z.object({
  email: EmailSchema,
  password: z.string(),
});

export type LoginDto = z.infer<typeof LoginDtoSchema>;

export interface AuthResponse {
  token: string;
  user: {
    id: string;
    email: string;
    name: string | null;
    /** 全局角色。ADMIN = 平台运营人员，与企业内角色是两套体系。 */
    role: string;
  };
  /**
   * 所属企业。平台运营人员不属于任何企业，故可为 null。
   * 前端存入 Zustand，用于企业管理台的数据归属显示。
   */
  enterprise: {
    id: string;
    name: string;
  } | null;
  /**
   * 企业内角色（ENTERPRISE_ADMIN / DEPT_MANAGER / MEMBER）。
   * 前端据此决定侧边栏可见项与按钮可操作性 ——
   * ⚠️ 仅为体验优化，真正的权限拦截在后端。
   */
  roleInEnterprise: string | null;
}

// Capability Upload
export const CapabilityUploadDtoSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().min(10).max(2000),
  type: z.enum(["agent", "rpa", "skill", "ai-app"]),
  industry: z.array(z.string()),
  position: z.array(z.string()),
  inputSchema: z.record(z.any()),
  outputSchema: z.record(z.any()),

  // Type-specific configs (conditional based on type)
  agentConfig: z
    .object({
      platform: z.enum(["coze", "dify", "n8n", "opencode"]),
      botId: z.string().optional(),
      apiKey: z.string().optional(),
      workflowUrl: z.string().url().optional(),
      skillName: z.string().optional(),
    })
    .optional(),

  rpaConfig: z
    .object({
      platform: z.enum(["shizai", "yingdao"]),
      executionMode: z.enum(["download", "cloud", "client"]),
      packageUrl: z.string().url().optional(),
      configDoc: z.string().optional(),
    })
    .optional(),

  skillConfig: z
    .object({
      template: z.string(),
      modelId: z.string().optional(),
      temperature: z.number().min(0).max(2).optional(),
      maxTokens: z.number().min(1).max(100000).optional(),
    })
    .optional(),

  aiAppConfig: z
    .object({
      integrationMode: z.enum(["api", "iframe", "redirect"]),
      apiUrl: z.string().url().optional(),
      webUrl: z.string().url().optional(),
    })
    .optional(),
});

export type CapabilityUploadDto = z.infer<typeof CapabilityUploadDtoSchema>;

// Digital Employee
export const DigitalEmployeeCreateDtoSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().min(10).max(2000),
  industry: z.string(),
  position: z.string(),
  functionalCategory: z.enum(["TECH", "PRODUCT_DESIGN", "MARKETING_GROWTH", "ECOMMERCE", "SALES_CUSTOMER", "OPERATIONS_ORG", "FINANCE_LEGAL"]).default("OPERATIONS_ORG"),
  avatar: z.string().url().optional(),
  systemPrompt: z.string().min(10),
  modelId: z.string().default(DEFAULT_MODEL_ID),
  maxSteps: z.number().min(1).max(20).default(10),
  price: z.number().min(0).optional(),
  // 初始绑定的已审核 Capability ID 列表（可为空）
  capabilityIds: z.array(z.string()).default([]),
});

export type DigitalEmployeeCreateDto = z.infer<
  typeof DigitalEmployeeCreateDtoSchema
>;

export const DigitalEmployeeUpdateDtoSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().min(10).max(2000).optional(),
  industry: z.string().optional(),
  position: z.string().optional(),
  functionalCategory: z.enum(["TECH", "PRODUCT_DESIGN", "MARKETING_GROWTH", "ECOMMERCE", "SALES_CUSTOMER", "OPERATIONS_ORG", "FINANCE_LEGAL"]).optional(),
  avatar: z.string().url().optional(),
  systemPrompt: z.string().min(10).optional(),
  modelId: z.string().optional(),
  maxSteps: z.number().min(1).max(20).optional(),
  price: z.number().min(0).optional(),
  status: z.enum(["DRAFT", "PENDING", "APPROVED", "REJECTED", "ARCHIVED"]).optional(),
  /**
   * 版本号。运营发版时同步更新这里和上传对应的员工包，
   * 已有实例的 upgradeAvailable 才会真正触发。
   */
  version: z.string().regex(/^\d+\.\d+\.\d+$/, '格式须为 x.y.z').optional(),
});

export type DigitalEmployeeUpdateDto = z.infer<
  typeof DigitalEmployeeUpdateDtoSchema
>;

export const BindCapabilityDtoSchema = z.object({
  capabilityId: z.string().min(1),
  priority: z.number().int().min(0).max(100).optional(),
});

export type BindCapabilityDto = z.infer<typeof BindCapabilityDtoSchema>;

// Subscription
export const SubscriptionCreateDtoSchema = z.object({
  employeeId: z.string(),
  config: z.record(z.any()).optional(),
});

export type SubscriptionCreateDto = z.infer<typeof SubscriptionCreateDtoSchema>;

/**
 * 修改雇佣关系。收敛后没有 departmentId ——
 * 部门差异化由 EmployeeGrant / KnowledgeGrant 的 departmentId 表达，
 * 雇佣关系本身不挂部门。
 */
export const SubscriptionUpdateDtoSchema = z.object({
  /** 企业内自定义称呼。传 null 恢复为展示模板名。 */
  name: z.string().min(1).max(50).nullable().optional(),
  config: z.record(z.any()).optional(),
});

export type SubscriptionUpdateDto = z.infer<typeof SubscriptionUpdateDtoSchema>;

/** 雇佣关系状态。收敛后 InstanceStatus 已并入此枚举。 */
export const SUBSCRIPTION_STATUSES = ['ACTIVE', 'PAUSED', 'EXPIRED'] as const;
export type SubscriptionStatusValue = (typeof SUBSCRIPTION_STATUSES)[number];

export const SubscriptionStatusDtoSchema = z.object({
  status: z.enum(SUBSCRIPTION_STATUSES),
});

export type SubscriptionStatusDto = z.infer<typeof SubscriptionStatusDtoSchema>;

// ============================================================================
// Enterprise Organization DTOs（P1 企业组织管理）
// ============================================================================

/** 企业内角色。与全局 UserRole 是两套体系。 */
export const ENTERPRISE_ROLES = [
  'ENTERPRISE_ADMIN',
  'DEPT_MANAGER',
  'MEMBER',
] as const;

export const EnterpriseRoleSchema = z.enum(ENTERPRISE_ROLES);
export type EnterpriseRoleValue = z.infer<typeof EnterpriseRoleSchema>;

/**
 * **可新分配**的企业角色 —— 不含 DEPT_MANAGER。
 *
 * 该角色本版暂按普通成员对待（详见 EnterpriseContextService.assertCanApprove），
 * 故不允许新设，但**枚举值保留**：库里已有的 DEPT_MANAGER 成员仍是合法数据，
 * 照常登录、按普通成员权限走。等「数据范围」那层做出来再放开。
 */
export const ASSIGNABLE_ENTERPRISE_ROLES = [
  'ENTERPRISE_ADMIN',
  'MEMBER',
] as const;

export const AssignableEnterpriseRoleSchema = z.enum(
  ASSIGNABLE_ENTERPRISE_ROLES,
);
export type AssignableEnterpriseRoleValue = z.infer<
  typeof AssignableEnterpriseRoleSchema
>;

// ── 部门 ────────────────────────────────────────────────────────────────────

export const DepartmentCreateDtoSchema = z.object({
  name: z.string().min(1).max(50),
  /** 父部门 id。省略表示顶级部门。 */
  parentId: z.string().optional(),
  sortOrder: z.number().int().optional(),
});
export type DepartmentCreateDto = z.infer<typeof DepartmentCreateDtoSchema>;

export const DepartmentUpdateDtoSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  /** 移动部门。传 null 表示提升为顶级部门。 */
  parentId: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
});
export type DepartmentUpdateDto = z.infer<typeof DepartmentUpdateDtoSchema>;

/** 部门树节点（含子节点，供前端直接渲染树形）。 */
export interface DepartmentTreeNode {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  memberCount: number;
  children: DepartmentTreeNode[];
}

// ── 成员 ────────────────────────────────────────────────────────────────────

/**
 * 添加企业成员。
 *
 * 这是第二个人进入企业的**唯一途径** —— 注册入口只用于开公司，
 * 同事若走注册会创建出另一家公司。
 *
 * MVP 采用「管理员代建账号 + 设初始密码」，不做邮件邀请
 * （邮件服务尚未接入）。
 */
export const MemberCreateDtoSchema = z.object({
  email: EmailSchema,
  name: z.string().min(1).max(50).optional(),
  /** 初始密码，成员首次登录后应自行修改 */
  password: z.string().min(8),
  role: AssignableEnterpriseRoleSchema.default('MEMBER'),
  departmentId: z.string().optional(),
  position: z.string().max(50).optional(),
});
export type MemberCreateDto = z.infer<typeof MemberCreateDtoSchema>;

export const MemberUpdateDtoSchema = z.object({
  role: AssignableEnterpriseRoleSchema.optional(),
  /** 调岗。传 null 表示移出部门。 */
  departmentId: z.string().nullable().optional(),
  position: z.string().max(50).nullable().optional(),
});
export type MemberUpdateDto = z.infer<typeof MemberUpdateDtoSchema>;

// ── 企业邀请 ────────────────────────────────────────────────────────────────

export const INVITATION_STATUSES = [
  'PENDING',
  'ACCEPTED',
  'EXPIRED',
  'REVOKED',
] as const;
export const InvitationStatusSchema = z.enum(INVITATION_STATUSES);
export type InvitationStatusValue = z.infer<typeof InvitationStatusSchema>;

/** 邀请默认有效期（天）。过期后 token 失效，需管理员重新邀请。 */
export const INVITATION_EXPIRES_DAYS = 7;

/**
 * 创建邀请。相比 MemberCreateDto 的「管理员代建账号 + 代设密码」，
 * 邀请制让被邀请人自己设密码 —— 管理员不接触他人凭据。
 *
 * MVP 不发邮件（邮件服务未接入），创建响应返回一次性链接，由管理员自行转达。
 */
export const InvitationCreateDtoSchema = z.object({
  email: EmailSchema,
  role: AssignableEnterpriseRoleSchema.default('MEMBER'),
  departmentId: z.string().optional(),
  position: z.string().max(50).optional(),
});
export type InvitationCreateDto = z.infer<typeof InvitationCreateDtoSchema>;

/**
 * 受邀注册。token 来自邀请链接，email 必须与邀请记录一致 ——
 * 否则链接被转发后任何人都能用它加入企业。
 */
export const RegisterByInvitationDtoSchema = z.object({
  token: z.string().min(1),
  email: EmailSchema,
  password: z.string().min(8),
  name: z.string().min(1).max(50).optional(),
});
export type RegisterByInvitationDto = z.infer<
  typeof RegisterByInvitationDtoSchema
>;

/**
 * 已登录用户接受邀请。
 * 不需要传 email —— 从 JWT 里取当前用户，再与邀请记录比对。
 */
export const AcceptInvitationDtoSchema = z.object({
  token: z.string().min(1),
});
export type AcceptInvitationDto = z.infer<typeof AcceptInvitationDtoSchema>;

// ── 员工授权 ────────────────────────────────────────────────────────────────

/**
 * 开通授权。授权对象**二选一**：整个部门，或具体某个成员。
 *
 * 用 refine 而非两个独立可选字段，是因为「都不传」会造出一条谁都匹配不上的
 * 死记录，「都传」的语义又无法定义（是且还是或？）。DB 层的
 * `@@unique([subscriptionId, departmentId, memberId])` 挡不住这两种情况。
 */
export const GrantCreateDtoSchema = z
  .object({
    departmentId: z.string().optional(),
    memberId: z.string().optional(),
    /** 限时授权到期时间（ISO 字符串）。省略表示长期有效。 */
    expiresAt: z.string().datetime().optional(),
  })
  .refine(
    (d) => Boolean(d.departmentId) !== Boolean(d.memberId),
    { message: '授权对象必须是部门或成员之一，不能同时指定或都不指定' },
  );
export type GrantCreateDto = z.infer<typeof GrantCreateDtoSchema>;

/** 一条授权记录。target 二选一，另一个为 null。 */
export interface GrantView {
  id: string;
  department: { id: string; name: string } | null;
  member: { id: string; name: string | null; email: string } | null;
  expiresAt: string | null;
  /** 已过期但未清理的记录，前端应标灰 */
  expired: boolean;
  createdAt: Date;
}

/**
 * 「我的员工」—— 当前成员可用的雇佣关系。
 *
 * 这是**使用者视角**，不含配置/升级等管理信息，但多一个 grantSource
 * 说明「为什么我能用这个」。
 */
export interface MyEmployeeView {
  /** 雇佣关系 id（收敛前是 instanceId）。所有下游操作都以此为锚点。 */
  subscriptionId: string;
  /** 企业自定义称呼，未设置时回落到模板名 */
  name: string;
  templateVersion: string;
  /** 员工模板。收敛前此字段名为 template。 */
  employee: { id: string; name: string; avatar: string | null };
  /**
   * 授权来源部门。收敛后语义变了 —— 从前是「实例归属哪个部门」，
   * 现在是「这条授权发给哪个部门」，DIRECT 授权时为 null。
   */
  department: { id: string; name: string } | null;
  /** 授权来源：直接给我的，还是给我所在部门的 */
  grantSource: 'DIRECT' | 'DEPARTMENT';
  expiresAt: string | null;
  /**
   * 该模板是否有可下载的员工包。为 false 时前端应禁用下载按钮 ——
   * 运营尚未上传包，点了只会拿到 404。
   */
  packageAvailable?: boolean;
}

// ── 员工包 ──────────────────────────────────────────────────────────────────

/** 发布新版本（multipart 表单的文本字段，文件另走 file 字段）*/
export const PackagePublishDtoSchema = z.object({
  /** 与 DigitalEmployee.version 同步更新，格式 x.y.z */
  version: z.string().regex(/^\d+\.\d+\.\d+$/, '版本格式须为 x.y.z'),
  changelog: z.string().max(500).optional(),
  /**
   * pi package 引用（决策 5）。
   * 若只填 packageRef 不上传文件，平台不经手字节流，客户端直接 `pi install`。
   * 若同时上传文件，两者并存（ZIP 作为兜底通道）。
   */
  packageRef: z.object({
    type: z.enum(['npm', 'git']),
    spec: z.string().min(1).max(200),
  }).optional(),
});
export type PackagePublishDto = z.infer<typeof PackagePublishDtoSchema>;

export interface PackageView {
  id: string;
  version: string;
  /** ZIP 文件名，packageRef-only 时为 null */
  filename: string | null;
  /** SHA-256，packageRef-only 时为 null */
  sha256: string | null;
  /** 文件大小，packageRef-only 时为 null */
  fileSizeBytes: number | null;
  /** pi package 引用，ZIP-only 时为 null */
  packageRef: { type: 'npm' | 'git'; spec: string } | null;
  changelog: string | null;
  createdAt: Date;
}

/** 客户端获取雇佣关系可安装的包信息（P3.2） */
export interface EmploymentPackageInfo {
  version: string;
  packageRef: { type: 'npm' | 'git'; spec: string } | null;
  /** ZIP 通道是否可用（packageRef 不存在时客户端可提示手动下载）*/
  zipAvailable: boolean;
  sha256: string | null;
}

/** 员工包大小上限。ZIP 里只装 skills 与说明，20MB 足够且能挡住误传大文件。 */
export const PACKAGE_MAX_BYTES = 20 * 1024 * 1024;

/**
 * 订阅视图（管理台）。收敛后订阅即雇佣关系，取代了原先的 InstanceView。
 */
export interface SubscriptionView {
  id: string;
  name: string;
  status: 'ACTIVE' | 'PAUSED' | 'EXPIRED';
  /** 订阅锁定的模板版本 */
  templateVersion: string;
  /** 模板当前最新版本 */
  latestVersion: string;
  /**
   * 是否有可用升级。提示式升级（决策 14）：不自动跟进，
   * 由企业在管理台主动确认。
   */
  upgradeAvailable: boolean;
  employee: { id: string; name: string; avatar: string | null };
  config: Record<string, unknown> | null;
  createdAt: Date;
}

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

/** 附件类别，与后端上传白名单（upload.constants.ts）保持一致 */
export const ATTACHMENT_TYPES = ['image', 'document', 'video'] as const;
export type AttachmentType = (typeof ATTACHMENT_TYPES)[number];

/**
 * 消息附件。前端不自造这个对象 —— 必须是 POST /upload/files 的返回值，
 * 否则 key 指向的对象不存在。url 有时效，key 才是永久标识。
 */
export const MessageAttachmentSchema = z.object({
  type: z.enum(ATTACHMENT_TYPES),
  key: z.string().min(1),
  // 绝对地址（OSS 驱动）或根相对路径（本地驱动，前端拼 /api 前缀走同源代理）。
  // 不能只收 .url()：本地驱动返回的就是 /uploads/...，那样所有本地上传都发不出去。
  url: z
    .string()
    .min(1)
    .refine(
      (v) => /^https?:\/\//i.test(v) || v.startsWith('/'),
      { message: '附件地址须为 http(s) 绝对地址或根相对路径' },
    ),
  name: z.string().min(1).max(255),
  size: z.number().int().nonnegative(),
  mimeType: z.string().optional(),
});

export type MessageAttachment = z.infer<typeof MessageAttachmentSchema>;

/** 单条消息最多携带的附件数，与 upload.constants.ts 的 MAX_FILES_PER_REQUEST 对齐 */
export const MAX_ATTACHMENTS_PER_MESSAGE = 5;

export const MessageSendDtoSchema = z.object({
  // 带附件时允许空文本（"看看这张图"式的纯附件消息），
  // 但不能既没文本也没附件
  content: z.string().max(10000),
  targetEmployeeId: z.string().optional(), // 指定处理该消息的员工（多员工协作）
  attachments: z
    .array(MessageAttachmentSchema)
    .max(MAX_ATTACHMENTS_PER_MESSAGE)
    .optional(),
}).refine(
  (dto) => dto.content.trim().length > 0 || (dto.attachments?.length ?? 0) > 0,
  { message: '消息内容和附件不能同时为空', path: ['content'] },
);

export type MessageSendDto = z.infer<typeof MessageSendDtoSchema>;

// User Profile
export const UpdateProfileDtoSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  avatar: z.string().url().optional(),
});

export type UpdateProfileDto = z.infer<typeof UpdateProfileDtoSchema>;

// ============================================================================
// Enterprise Model Config DTOs (Phase 1 — 模型配置中心)
// ============================================================================

export const EMPLOYEE_MODEL_POLICIES = ['FOLLOW_TEMPLATE', 'FORCE_DEFAULT'] as const;
export type EmployeeModelPolicy = (typeof EMPLOYEE_MODEL_POLICIES)[number];

export const UpdateEnterpriseModelConfigDtoSchema = z.object({
  defaultChatModel: z.string().min(1).optional(),
  allowedChatModels: z.array(z.string()).optional(),
  allowUserSwitchModel: z.boolean().optional(),
  embeddingModel: z.string().min(1).optional(),
  rerankModel: z.string().nullable().optional(),
  embeddingBatchSize: z.number().int().min(1).max(256).optional(),
  embeddingTimeoutMs: z.number().int().min(1000).max(120000).optional(),
  employeeModelPolicy: z.enum(EMPLOYEE_MODEL_POLICIES).optional(),
  employeeDefaultModel: z.string().nullable().optional(),
  monthlyBudgetCNY: z.number().positive().nullable().optional(),
  alertThreshold: z.number().min(0).max(1).optional(),
  hardStopOnBudget: z.boolean().optional(),
});
export type UpdateEnterpriseModelConfigDto = z.infer<typeof UpdateEnterpriseModelConfigDtoSchema>;

export const DepartmentModelPolicyDtoSchema = z.object({
  defaultChatModel: z.string().nullable().optional(),
  allowedChatModels: z.array(z.string()).optional(),
});
export type DepartmentModelPolicyDto = z.infer<typeof DepartmentModelPolicyDtoSchema>;

/** 解析后最终生效的模型配置（会话侧消费） */
export interface EffectiveModelConfig {
  chatModel: string;
  allowedChatModels: string[];
  allowUserSwitchModel: boolean;
  embeddingModel: string;
  rerankModel: string | null;
  embeddingBatchSize: number;
  embeddingTimeoutMs: number;
  /** 超预算且 hardStopOnBudget=true 时为 true */
  budgetExceeded: boolean;
}

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

// ============================================================================
// Model Pricing (计费价格表)
// ----------------------------------------------------------------------------
// 单位：美元 / 1M tokens
// 数据来源：各厂商官网定价（截至 2026-07）
// ============================================================================

export interface ModelPricing {
  inputPrice: number; // 输入 token 单价（美元 / 1M tokens）
  outputPrice: number; // 输出 token 单价（美元 / 1M tokens）
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  "deepseek-v4-flash": { inputPrice: 0.14, outputPrice: 0.55 },
  "deepseek-v4-pro": { inputPrice: 2.19, outputPrice: 8.77 },
  "gemini-3.5-flash-high": { inputPrice: 0.15, outputPrice: 0.6 },
  "gpt-4o": { inputPrice: 2.5, outputPrice: 10.0 },
  "gpt-4o-mini": { inputPrice: 0.15, outputPrice: 0.6 },
  "claude-sonnet-5": { inputPrice: 3.0, outputPrice: 15.0 },
  "claude-haiku-4-5": { inputPrice: 0.8, outputPrice: 4.0 },
};

/** 解析汇率配置值，非法输入回退默认值（避免把 NaN 写进账单）。 */
export function parseUsdToCnyRate(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_USD_TO_CNY_RATE;
}

/**
 * 保底价：取 MODEL_PRICING 中各维度的最高单价。
 * 未在价格表中的模型（上游 57 个里只有 7 个配了价）按此保底计费，
 * 宁可多收也不漏收，避免未配价模型被启用后「免费对话」。
 * 管理端应对这类模型显示警示，提醒尽快补上真实价格。
 */
export const FALLBACK_PRICING: ModelPricing = {
  inputPrice: Math.max(
    ...Object.values(MODEL_PRICING).map((p) => p.inputPrice),
  ),
  outputPrice: Math.max(
    ...Object.values(MODEL_PRICING).map((p) => p.outputPrice),
  ),
};

/** 该模型是否已配置真实价格（未配则计费走保底价）。 */
export function hasPricing(modelId: string): boolean {
  return modelId in MODEL_PRICING;
}

/**
 * 计算单次对话的成本
 * @param modelId 模型 ID
 * @param inputTokens 输入 token 数
 * @param outputTokens 输出 token 数
 * @param rate 生效汇率，省略则用默认值（调用方应从系统设置读取后传入）
 * @returns { costUSD, costCNY, isFallback, rate } 成本 + 是否走保底价 + 实际用的汇率
 */
export function calculateCost(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
  rate: number = DEFAULT_USD_TO_CNY_RATE,
): {
  costUSD: number;
  costCNY: number;
  isFallback: boolean;
  rate: number;
} {
  const isFallback = !hasPricing(modelId);
  const pricing = isFallback ? FALLBACK_PRICING : MODEL_PRICING[modelId];
  const costUSD =
    (inputTokens * pricing.inputPrice + outputTokens * pricing.outputPrice) /
    1_000_000;
  const costCNY = costUSD * rate;
  // 返回 rate：账单需可复核 —— 汇率改动后旧账单仍应能解释当时的金额
  return { costUSD, costCNY, isFallback, rate };
}

// ============================================================================
// Client Auth DTOs (P4)
// ============================================================================
export const ClientLoginDtoSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1),
  fingerprint: z.string().min(1).max(256),
  platform: z.enum(['darwin', 'win32', 'linux']).or(z.string()),
  clientVersion: z.string().optional(),
});
export type ClientLoginDto = z.infer<typeof ClientLoginDtoSchema>;

export const ClientTokenDtoSchema = z.object({
  refreshToken: z.string().min(1),
  subscriptionId: z.string().min(1),
});
export type ClientTokenDto = z.infer<typeof ClientTokenDtoSchema>;

// ============================================================================
// Gateway Layer Types (OpenAI-compatible chat completion)
// ============================================================================

export const ChatCompletionRequestSchema = z.object({
  model: z.string().min(1),
  messages: z.array(
    z.object({
      role: z.enum(['system', 'user', 'assistant', 'tool']),
      content: z.string(),
      name: z.string().optional(),
    }),
  ),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().optional(),
  stream: z.boolean().optional(),
  tools: z.array(z.any()).optional(),
});
export type ChatCompletionRequest = z.infer<typeof ChatCompletionRequestSchema>;

export interface ChatCompletionUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/**
 * 计算模型调用成本（CNY）。
 * @param modelId 模型ID（如 gpt-4）
 * @param inputTokens prompt token数
 * @param outputTokens completion token数
 * @param usdRate 美元→人民币汇率
 * @returns 成本（人民币）
 */
export function calculateModelCost(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
  usdRate: number,
): number {
  // 简化版：用默认费率，后续从 PlatformModel 读单价
  const RATES: Record<string, { input: number; output: number }> = {
    'gpt-4': { input: 0.03 / 1000, output: 0.06 / 1000 },  // USD per token
    'gpt-3.5-turbo': { input: 0.001 / 1000, output: 0.002 / 1000 },
    'claude-3-opus': { input: 0.015 / 1000, output: 0.075 / 1000 },
  };
  const rate = RATES[modelId] || RATES['gpt-3.5-turbo']; // fallback
  const costUsd = inputTokens * rate.input + outputTokens * rate.output;
  return costUsd * usdRate;
}

// ============================================================================
// Department Member Management DTOs
// ============================================================================

/** 批量将成员（EnterpriseMember）分配到某部门 */
export const AssignDeptMembersDtoSchema = z.object({
  memberIds: z.array(z.string()).min(1, '至少指定一位成员'),
});
export type AssignDeptMembersDto = z.infer<typeof AssignDeptMembersDtoSchema>;

/** 设置 / 清除部门主管 */
export const SetDeptLeaderDtoSchema = z.object({
  memberId: z.string().nullable(),
});
export type SetDeptLeaderDto = z.infer<typeof SetDeptLeaderDtoSchema>;

// ============================================================================
// Knowledge Base DTOs
// ============================================================================

export * from './knowledge.dto';

// ============================================================================
// Compute Account DTOs
// ============================================================================

export * from './compute.dto';

// ============================================================================
// Model Config DTOs
// ============================================================================

export * from './model-config.dto';

// ============================================================================
// Enterprise Settings DTOs (Phase 4 · 企业设置拆分 + 权限细化)
// ============================================================================

export * from './enterprise-settings.dto';
export * from './skill-version.dto';

// ============================================================================
// Cost Analytics DTOs
// ============================================================================

export const CostSummarySchema = z.object({
  totalCost: z.number(),
  budgetCNY: z.number().nullable(),
  budgetUsagePercent: z.number().nullable(),
  periodStart: z.string(),
  periodEnd: z.string(),
  comparisonPeriodCost: z.number().optional(),
  changePercent: z.number().optional(),
});
export type CostSummary = z.infer<typeof CostSummarySchema>;

export const CostByDimensionItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  cost: z.number(),
  percent: z.number(),
  messageCount: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
});
export type CostByDimensionItem = z.infer<typeof CostByDimensionItemSchema>;

export const CostTrendPointSchema = z.object({
  date: z.string(),
  cost: z.number(),
  messageCount: z.number(),
});
export type CostTrendPoint = z.infer<typeof CostTrendPointSchema>;

export const CostAlertSchema = z.object({
  id: z.string(),
  type: z.enum(['BUDGET_THRESHOLD', 'BUDGET_EXCEEDED', 'ANOMALY']),
  severity: z.enum(['WARNING', 'ERROR']),
  message: z.string(),
  triggeredAt: z.string(),
  acknowledged: z.boolean(),
});
export type CostAlert = z.infer<typeof CostAlertSchema>;
