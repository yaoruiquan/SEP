// Mirror of backend response shapes (kept minimal, only what the UI reads).

export type CapabilityType = 'AGENT' | 'RPA' | 'SKILL' | 'AI_APP';
export type EmployeeStatus = 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'ARCHIVED';
export type SubscriptionStatus = 'ACTIVE' | 'PAUSED' | 'EXPIRED';
export type CapabilityStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type UserRole = 'USER' | 'ADMIN';

export interface UserProfile {
  id: string;
  email: string;
  name: string | null;
  avatar: string | null;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
}

export interface Capability {
  id: string;
  name: string;
  description: string;
  type: CapabilityType;
  industry: string[];
  position: string[];
  status: CapabilityStatus;
  createdAt: string;
}

export interface CapabilityBinding {
  id: string;
  order: number;
  capability: Capability;
}

export interface DigitalEmployee {
  id: string;
  name: string;
  description: string;
  industry: string;
  position: string;
  avatar: string | null;
  systemPrompt?: string;
  modelId?: string;
  maxSteps?: number;
  price: number;
  version: string;
  status: EmployeeStatus;
  createdAt: string;
  bindings?: CapabilityBinding[];
  _count?: { bindings?: number; subscriptions?: number };
}

export interface Subscription {
  id: string;
  status: SubscriptionStatus;
  config: Record<string, unknown> | null;
  startDate: string;
  endDate: string | null;
  createdAt: string;
  employee: DigitalEmployee;
}

export interface ConversationSession {
  id: string;
  title: string | null;
  employeeId: string;
  modelId?: string | null; // 会话级模型覆盖
  createdAt: string;
  updatedAt: string;
  employee?: Pick<DigitalEmployee, 'id' | 'name' | 'avatar' | 'modelId'>;
  _count?: { messages?: number };
}

export interface ToolCallRecord {
  name?: string;
  capabilityId?: string;
  success?: boolean;
  durationMs?: number;
  arguments?: Record<string, unknown>;
  result?: unknown;
  [key: string]: unknown;
}

export type AttachmentType = 'image' | 'document' | 'video';

/**
 * 消息附件 —— 与后端 `MessageAttachmentSchema` 一一对应。
 *
 * `key` 是存储对象的永久标识，`url` 是有时效的签名链接。会话详情接口每次
 * 读取都会按 key 重签 url，所以渲染时直接用 url；只有长时间停留在页面上
 * 才可能过期，那时用 key 走 `POST /upload/refresh-url` 重取。
 */
export interface MessageAttachment {
  type: AttachmentType;
  key: string;
  url: string;
  name: string;
  size: number;
  mimeType?: string;
}

export interface Message {
  id: string;
  role: 'USER' | 'ASSISTANT' | 'TOOL';
  content: string;
  toolCalls?: ToolCallRecord[] | null;
  knowledgeSources?: KnowledgeSource[] | null;
  /** 多模态附件（仅用户消息） */
  attachments?: MessageAttachment[] | null;
  /** 多员工协作：实际处理该消息的员工 ID，缺失时归属会话默认员工 */
  metadata?: { handledBy?: string } | null;
  createdAt: string;
}

export interface KnowledgeSource {
  chunkId: string;
  content: string;
  source: string;
  score: number;
  knowledgeBaseId: string;
}

export interface ConversationDetail extends ConversationSession {
  messages: Message[];
}

/**
 * 人才市场的公开员工视图 —— 后端 select 白名单的投影结果。
 *
 * 刻意**没有** systemPrompt / modelId / maxSteps：提示词等于这个员工的
 * 全部内容，不对访客公开。需要这些字段的地方（管理端）用 DigitalEmployee。
 */
export interface MarketEmployee {
  id: string;
  name: string;
  description: string;
  industry: string;
  position: string;
  avatar: string | null;
  price: number | null;
  annualPriceCNY: number | null;
  includedComputeCNY: number;
  version: string;
  publishedAt: string | null;
  bindings: {
    id: string;
    order: number;
    capability: {
      id: string;
      name: string;
      type: CapabilityType;
      description: string;
    };
  }[];
  _count?: { subscriptions?: number };
}

// ── 企业组织 ──────────────────────────────────────────────────────────────────

export type InstanceStatus = 'PENDING_ACTIVATION' | 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
export type EnterpriseRole = 'ENTERPRISE_ADMIN' | 'DEPT_MANAGER' | 'MEMBER';

export interface Department {
  id: string;
  name: string;
  sortOrder: number;
  parentId: string | null;
  children: Department[];
  _count?: { members: number };
}

export interface EnterpriseMember {
  id: string;
  role: EnterpriseRole;
  position: string | null;
  createdAt: string;
  user: { id: string; email: string; name: string | null; avatar: string | null };
  department: { id: string; name: string; parent: { id: string; name: string } | null } | null;
}

export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED';

export interface EnterpriseInvitation {
  id: string;
  email: string;
  role: EnterpriseRole;
  position: string | null;
  status: InvitationStatus;
  expiresAt: string;
  createdAt: string;
  /** 仅 ACCEPTED 有值 */
  acceptedAt?: string | null;
  department: { id: string; name: string } | null;
}

/**
 * 创建邀请的响应。`token` 是**一次性明文**，只在此响应里出现 ——
 * 列表接口不返回它（库里只存 SHA-256 摘要）。
 * 所以 UI 必须在拿到响应时立刻把链接呈现给管理员，关闭后无法找回。
 */
export interface CreatedInvitation extends EnterpriseInvitation {
  token: string;
}

/**
 * `GET /auth/invitations/verify` 的响应 —— 受邀页在用户还没有账号时就要
 * 展示「你被邀请加入 X 公司」，所以这个接口是公开的。
 *
 * 字段是刻意裁剪过的：只有展示所需的企业名/角色/部门，不含企业组织结构。
 * 后端对「不存在」与「已失效」返回**同一个** 400 措辞，
 * 故前端不要试图从错误里区分二者 —— 那个区分本身就是 token 枚举的入口。
 */
export interface InvitationPreview {
  id: string;
  email: string;
  role: EnterpriseRole;
  position: string | null;
  status: InvitationStatus;
  expiresAt: string;
  enterprise: { id: string; name: string; logo: string | null };
  department: { id: string; name: string } | null;
}

/**
 * 移出成员 / 主动离职的处置结果。
 * `vacatedDepartments` 非空表示这些部门失去了负责人，需要管理员补指派 ——
 * 后端刻意不阻塞移出，把补动作交给 UI 提示。
 */
export interface OffboardResult {
  id: string;
  removed: boolean;
  reclaimedGrants: number;
  canceledRequests: number;
  vacatedDepartments: { id: string; name: string }[];
}

export interface EmployeeInstance {
  id: string;
  name: string;
  status: InstanceStatus;
  templateVersion: string;
  latestVersion: string;
  upgradeAvailable: boolean;
  template: { id: string; name: string; avatar: string | null };
  department: { id: string; name: string } | null;
  config: Record<string, unknown> | null;
  createdAt: string;
}

export interface GrantRecord {
  id: string;
  department: { id: string; name: string } | null;
  member: { id: string; name: string | null; email: string } | null;
  expiresAt: string | null;
  expired: boolean;
  createdAt: string;
}

export interface MyEmployee {
  instanceId: string;
  name: string;
  templateVersion: string;
  template: {
    id: string;
    name: string;
    avatar: string | null;
    bindings?: Array<{
      id: string;
      priority: number;
      capability: {
        id: string;
        name: string;
        type: CapabilityType;
        description: string;
      };
    }>;
  };
  department: { id: string; name: string } | null;
  grantSource: 'DIRECT' | 'DEPARTMENT';
  expiresAt: string | null;
  /** 运营是否已上传员工包；false 时下载按钮应禁用 */
  packageAvailable?: boolean;
}

/** 员工包的一个已发布版本 */
export interface EmployeePackage {
  id: string;
  version: string;
  filename: string | null;
  /** SHA-256 十六进制，供下载方核对完整性（ZIP 上传时有值） */
  sha256: string | null;
  fileSizeBytes: number | null;
  /** pi package 引用（packageRef 模式时有值，ZIP 模式为 null）*/
  packageRef: { type: 'npm' | 'git'; spec: string } | null;
  changelog: string | null;
  createdAt: string;
}

// ============================================================================
// Enterprise Model Config Types (Phase 1)
// ============================================================================

export type EmployeeModelPolicy = "FOLLOW_TEMPLATE" | "FORCE_DEFAULT";

export interface UpdateEnterpriseModelConfigDto {
  defaultChatModel?: string;
  allowedChatModels?: string[];
  allowUserSwitchModel?: boolean;
  embeddingModel?: string;
  rerankModel?: string | null;
  embeddingBatchSize?: number;
  embeddingTimeoutMs?: number;
  employeeModelPolicy?: EmployeeModelPolicy;
  employeeDefaultModel?: string | null;
  monthlyBudgetCNY?: number | null;
  alertThreshold?: number;
  hardStopOnBudget?: boolean;
}

export interface DepartmentModelPolicyDto {
  defaultChatModel?: string | null;
  allowedChatModels?: string[];
}

/** 模型来源，按解析优先级从高到低 */
export type EffectiveModelSource =
  | 'USER_CHOICE'
  | 'EMPLOYEE_INSTANCE'
  | 'DEPARTMENT'
  | 'ENTERPRISE'
  | 'SYSTEM_DEFAULT';

export interface EffectiveModelConfig {
  chatModel: string;
  allowedChatModels: string[];
  allowUserSwitchModel: boolean;
  embeddingModel: string;
  rerankModel: string | null;
  embeddingBatchSize: number;
  embeddingTimeoutMs: number;
  /** 本月是否已超预算（事实判断，与是否硬性阻断无关） */
  budgetExceeded: boolean;
  source: EffectiveModelSource;
}

export interface DeptMemberItem {
  id: string;
  role: EnterpriseRole;
  position: string | null;
  createdAt: string;
  user: {
    id: string;
    name: string | null;
    email: string;
    avatar: string | null;
  };
}

export interface DeptMembersResponse {
  total: number;
  page: number;
  limit: number;
  leaderId: string | null;
  items: DeptMemberItem[];
}

export interface KnowledgeBase {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  creator: { name: string | null; email: string };
  _count?: {
    documents?: number;
    textChunks?: number;
    grants?: number;
  };
}

/** 知识库详情（GET /knowledge/:id），_count 字段均存在且为数值 */
export interface KnowledgeBaseDetail extends Omit<KnowledgeBase, '_count'> {
  _count: {
    documents: number;
    textChunks: number;
    grants: number;
  };
}

// ── Cost Analytics (Phase 3) ──────────────────────────────────────────────────

export interface CostSummary {
  totalCost: number;
  budgetCNY: number | null;
  budgetUsagePercent: number | null;
  periodStart: string;
  periodEnd: string;
  comparisonPeriodCost?: number;
  changePercent?: number;
}

export interface CostByDimensionItem {
  id: string;
  name: string;
  cost: number;
  percent: number;
  messageCount: number;
  inputTokens: number;
  outputTokens: number;
}

export interface CostTrendPoint {
  date: string;
  cost: number;
  messageCount: number;
}

export interface CostAlert {
  id: string;
  type: 'BUDGET_THRESHOLD' | 'BUDGET_EXCEEDED' | 'ANOMALY';
  severity: 'WARNING' | 'ERROR';
  message: string;
  triggeredAt: string;
  acknowledged: boolean;
}
