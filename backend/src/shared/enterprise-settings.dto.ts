import { z } from 'zod';

// ============================================================================
// Enterprise Permissions (Phase 4 · 企业细粒度权限)
// ----------------------------------------------------------------------------
// 格式：<资源>:<动作>，资源复数，动作小写动词。
// 内置角色权限集见 DEFAULT_ROLE_PERMISSIONS。
// ============================================================================

export const ENTERPRISE_PERMISSIONS = [
  // 成员管理
  'members:read',
  'members:create',
  'members:update',
  'members:delete',
  // 部门管理
  'departments:read',
  'departments:create',
  'departments:update',
  'departments:delete',
  // 角色管理
  'roles:read',
  'roles:create',
  'roles:update',
  'roles:delete',
  // 企业设置
  'settings:read',
  'settings:update',
  // API 密钥
  'api-keys:read',
  'api-keys:create',
  'api-keys:revoke',
  // 员工实例
  'instances:read',
  'instances:create',
  'instances:update',
  'instances:delete',
  'instances:grant',
  // 费用与统计
  'costs:read',
  // 知识库
  'knowledge:read',
  'knowledge:create',
  'knowledge:update',
  'knowledge:delete',
] as const;

export type EnterprisePermission = (typeof ENTERPRISE_PERMISSIONS)[number];

export const EnterprisePermissionSchema = z.enum(ENTERPRISE_PERMISSIONS);

/** 内置角色的默认权限集（isBuiltin=true 的 CustomRole 初始化数据参照此处）。 */
export const DEFAULT_ROLE_PERMISSIONS: Record<string, EnterprisePermission[]> = {
  ENTERPRISE_ADMIN: [...ENTERPRISE_PERMISSIONS], // 全量权限
  DEPT_MANAGER: [
    'members:read',
    'members:update',
    'departments:read',
    'instances:read',
    'instances:grant',
    'costs:read',
    'knowledge:read',
  ],
  MEMBER: [
    'instances:read',
    'knowledge:read',
  ],
};

// ============================================================================
// EnterpriseSetting DTOs
// ============================================================================

export const UpdateEnterpriseSettingDtoSchema = z.object({
  sensitiveWordsEnabled: z.boolean().optional(),
  /** 敏感词列表，每项最长 50 字。 */
  sensitiveWords: z.array(z.string().max(50)).max(500).optional(),
  /** IP 白名单，CIDR 或精确地址，每项最长 45 字（IPv6 最长）。 */
  ipWhitelist: z.array(z.string().max(45)).max(100).optional(),
  /** 会话超时（分钟），范围 5~10080（1 周）。 */
  sessionTimeoutMinutes: z.number().int().min(5).max(10080).optional(),
  /** 强制密码轮换（天），null 表示不强制。 */
  forcePasswordRotationDays: z.number().int().min(7).max(365).nullable().optional(),
  webhookUrl: z.string().url().nullable().optional(),
  /**
   * Webhook 密钥。传入时服务端 bcrypt 加密存储，接口永不回传明文。
   * 传 null 清除。
   */
  webhookSecret: z.string().min(8).max(128).nullable().optional(),
});
export type UpdateEnterpriseSettingDto = z.infer<typeof UpdateEnterpriseSettingDtoSchema>;

/** 接口返回体（webhookSecret 永不下发明文）。 */
export interface EnterpriseSettingView {
  id: string;
  sensitiveWordsEnabled: boolean;
  sensitiveWords: string[];
  ipWhitelist: string[];
  sessionTimeoutMinutes: number;
  forcePasswordRotationDays: number | null;
  webhookUrl: string | null;
  /** 是否已配置密钥（不暴露明文）。 */
  webhookSecretConfigured: boolean;
  updatedAt: Date;
}

// ============================================================================
// CustomRole DTOs
// ============================================================================

export const CreateCustomRoleDtoSchema = z.object({
  name: z.string().min(1).max(50),
  description: z.string().max(200).optional(),
  permissions: z.array(EnterprisePermissionSchema).min(1),
});
export type CreateCustomRoleDto = z.infer<typeof CreateCustomRoleDtoSchema>;

export const UpdateCustomRoleDtoSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  description: z.string().max(200).nullable().optional(),
  permissions: z.array(EnterprisePermissionSchema).min(1).optional(),
});
export type UpdateCustomRoleDto = z.infer<typeof UpdateCustomRoleDtoSchema>;

export interface CustomRoleView {
  id: string;
  name: string;
  description: string | null;
  permissions: EnterprisePermission[];
  /** true 表示内置角色，名称与权限不可修改。 */
  isBuiltin: boolean;
  memberCount: number;
  createdAt: Date;
  updatedAt: Date;
}

/** 将角色分配给企业成员。 */
export const AssignCustomRoleDtoSchema = z.object({
  /** null 表示清除自定义角色（回退到内置 role 枚举的权限）。 */
  customRoleId: z.string().nullable(),
});
export type AssignCustomRoleDto = z.infer<typeof AssignCustomRoleDtoSchema>;

// ============================================================================
// EnterpriseApiKey DTOs
// ============================================================================

export const CREATE_API_KEY_SCOPES = [
  'chat:read',
  'knowledge:read',
  'instances:read',
] as const;
export type ApiKeyScope = (typeof CREATE_API_KEY_SCOPES)[number];

export const CreateApiKeyDtoSchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(z.enum(CREATE_API_KEY_SCOPES)).min(1),
  /** 过期时间（ISO 字符串），省略表示长期有效。 */
  expiresAt: z.string().datetime().optional(),
});
export type CreateApiKeyDto = z.infer<typeof CreateApiKeyDtoSchema>;

/** 创建成功时的一次性响应（含明文 key，唯一一次）。 */
export interface CreateApiKeyResponse {
  id: string;
  name: string;
  /** 明文密钥，**仅此一次**，请提示用户妥善保存。 */
  key: string;
  keyPrefix: string;
  scopes: ApiKeyScope[];
  expiresAt: string | null;
  createdAt: Date;
}

/** 列表/详情视图（不含明文 key）。 */
export interface ApiKeyView {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: ApiKeyScope[];
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  /** 是否有效（未吊销且未过期）。 */
  active: boolean;
  createdBy: string;
  createdAt: Date;
}

// ============================================================================
// ApiCallLog DTOs
// ============================================================================

export interface ApiCallLogView {
  id: string;
  apiKeyId: string | null;
  /** 密钥名称（可能已吊销，名称仍存在）。 */
  apiKeyName: string | null;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  ip: string | null;
  createdAt: Date;
}

export const ApiCallLogQueryDtoSchema = z.object({
  /** 开始日期 ISO 字符串 */
  from: z.string().datetime().optional(),
  /** 结束日期 ISO 字符串 */
  to: z.string().datetime().optional(),
  apiKeyId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ApiCallLogQueryDto = z.infer<typeof ApiCallLogQueryDtoSchema>;
