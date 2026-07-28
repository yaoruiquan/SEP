// Mirror of backend response shapes (kept minimal, only what the UI reads).

export type CapabilityType = 'AGENT' | 'RPA' | 'SKILL' | 'AI_APP';
export type EmployeeStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
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
  status: EmployeeStatus;
  createdAt: string;
  bindings?: CapabilityBinding[];
  _count?: { bindings?: number; subscriptions?: number };
}

export interface Subscription {
  id: string;
  status: SubscriptionStatus;
  config: Record<string, unknown> | null;
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

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCallRecord[] | null;
  createdAt: string;
}

export interface ConversationDetail extends ConversationSession {
  messages: Message[];
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
  department: { id: string; name: string } | null;
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
  template: { id: string; name: string; avatar: string | null };
  department: { id: string; name: string } | null;
  grantSource: 'DIRECT' | 'DEPARTMENT';
  expiresAt: string | null;
}
