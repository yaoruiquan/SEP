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
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

/** 哪些配置项是敏感值（加密存储、接口打码）。 */
export const SECRET_SETTING_KEYS: readonly SettingKey[] = [
  SETTING_KEYS.SUB2API_API_KEY,
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
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().optional(),
  /** 公司名称。注册即创建该企业，注册人成为其首个企业管理员。 */
  enterpriseName: z.string().min(2).max(100),
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
  avatar: z.string().url().optional(),
  systemPrompt: z.string().min(10).optional(),
  modelId: z.string().optional(),
  maxSteps: z.number().min(1).max(20).optional(),
  price: z.number().min(0).optional(),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional(),
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
  order: z.number().int().min(0).optional(),
});

export type BindCapabilityDto = z.infer<typeof BindCapabilityDtoSchema>;

// Subscription
export const SubscriptionCreateDtoSchema = z.object({
  employeeId: z.string(),
  config: z.record(z.any()).optional(),
});

export type SubscriptionCreateDto = z.infer<typeof SubscriptionCreateDtoSchema>;

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
  email: z.string().email(),
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

// ── 员工实例 ────────────────────────────────────────────────────────────────

export const INSTANCE_STATUSES = [
  'PENDING_ACTIVATION',
  'ACTIVE',
  'SUSPENDED',
  'REVOKED',
] as const;
export const InstanceStatusSchema = z.enum(INSTANCE_STATUSES);
export type InstanceStatusValue = z.infer<typeof InstanceStatusSchema>;

/**
 * 创建员工实例。
 *
 * 订阅是**企业级**的（一个模板订阅一次），实例是**部门/岗位级**的 ——
 * 一次订阅可开多个实例（决策 8），如技术部与运营部各一份，
 * 各自独立命名与配置。
 */
export const InstanceCreateDtoSchema = z.object({
  /** 来源模板 id。必须是本企业已订阅且订阅有效的模板。 */
  templateId: z.string(),
  /** 企业内名称，如「视频工程师」 */
  name: z.string().min(1).max(50),
  /** 归属部门。省略表示企业级共享实例。 */
  departmentId: z.string().optional(),
  config: z.record(z.any()).optional(),
});
export type InstanceCreateDto = z.infer<typeof InstanceCreateDtoSchema>;

export const InstanceUpdateDtoSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  /** 调整归属部门。传 null 表示改为企业级共享。 */
  departmentId: z.string().nullable().optional(),
  config: z.record(z.any()).optional(),
});
export type InstanceUpdateDto = z.infer<typeof InstanceUpdateDtoSchema>;

/** 实例状态变更。REVOKED 为终态，不可再转回。 */
export const InstanceStatusUpdateDtoSchema = z.object({
  status: InstanceStatusSchema,
});
export type InstanceStatusUpdateDto = z.infer<
  typeof InstanceStatusUpdateDtoSchema
>;

/** 实例视图，含升级提示信息。 */
// ── 员工授权 ────────────────────────────────────────────────────────────────

/**
 * 开通授权。授权对象**二选一**：整个部门，或具体某个成员。
 *
 * 用 refine 而非两个独立可选字段，是因为「都不传」会造出一条谁都匹配不上的
 * 死记录，「都传」的语义又无法定义（是且还是或？）。DB 层的
 * `@@unique([instanceId, departmentId, memberId])` 挡不住这两种情况。
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
 * 「我的员工」—— 当前成员可用的实例。
 *
 * 与 InstanceView 的区别：这是**使用者视角**，不含配置/升级等管理信息，
 * 但多一个 grantSource 说明「为什么我能用这个」。
 */
export interface MyEmployeeView {
  instanceId: string;
  name: string;
  templateVersion: string;
  template: { id: string; name: string; avatar: string | null };
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

/** 客户端获取实例可安装的包信息（P3.2） */
export interface InstancePackageInfo {
  version: string;
  packageRef: { type: 'npm' | 'git'; spec: string } | null;
  /** ZIP 通道是否可用（packageRef 不存在时客户端可提示手动下载）*/
  zipAvailable: boolean;
  sha256: string | null;
}

/** 员工包大小上限。ZIP 里只装 skills 与说明，20MB 足够且能挡住误传大文件。 */
export const PACKAGE_MAX_BYTES = 20 * 1024 * 1024;

export interface InstanceView {
  id: string;
  name: string;
  status: InstanceStatusValue;
  /** 实例锁定的模板版本 */
  templateVersion: string;
  /** 模板当前最新版本 */
  latestVersion: string;
  /**
   * 是否有可用升级。提示式升级（决策 14）：不自动跟进，
   * 由企业在管理台主动确认。
   */
  upgradeAvailable: boolean;
  template: { id: string; name: string; avatar: string | null };
  department: { id: string; name: string } | null;
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
  email: z.string().email(),
  password: z.string().min(1),
  fingerprint: z.string().min(1).max(256),
  platform: z.enum(['darwin', 'win32', 'linux']).or(z.string()),
  clientVersion: z.string().optional(),
});
export type ClientLoginDto = z.infer<typeof ClientLoginDtoSchema>;

export const ClientTokenDtoSchema = z.object({
  refreshToken: z.string().min(1),
  instanceId: z.string().min(1),
});
export type ClientTokenDto = z.infer<typeof ClientTokenDtoSchema>;
