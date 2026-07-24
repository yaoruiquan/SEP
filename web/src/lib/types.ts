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
  createdAt: string;
  updatedAt: string;
  employee?: Pick<DigitalEmployee, 'id' | 'name' | 'avatar'>;
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
