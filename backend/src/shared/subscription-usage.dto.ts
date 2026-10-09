import { z } from 'zod';

export const SubscriptionUsageSourceSchema = z.enum([
  'client',
  'client-legacy',
  'web-conversation',
  'web-task',
]);
export type SubscriptionUsageSource = z.infer<
  typeof SubscriptionUsageSourceSchema
>;

// Date-only filters denote midnight in the business timezone, not UTC midnight.
const businessDate = z
  .string()
  .refine((value) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const date = new Date(`${value}T00:00:00Z`);
      return (
        Number.isFinite(date.getTime()) &&
        date.toISOString().slice(0, 10) === value
      );
    }
    return z.string().datetime({ offset: true }).safeParse(value).success;
  }, '日期必须为有效的 YYYY-MM-DD 或带时区 ISO 时间')
  .transform((value) =>
    new Date(
      value.length === 10 ? `${value}T00:00:00+08:00` : value,
    ).toISOString(),
  );

export const SubscriptionUsageQueryDtoSchema = z
  .object({
    source: SubscriptionUsageSourceSchema.optional(),
    order: z.enum(['asc', 'desc']).default('desc'),
    userId: z.string().trim().min(1).max(128).optional(),
    from: businessDate.optional(),
    to: businessDate.optional(),
    page: z.coerce.number().int().min(1).max(1000000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict()
  .refine((query) => !query.from || !query.to || query.from < query.to, {
    path: ['to'],
    message: 'to 必须晚于 from（时间范围为 [from,to)）',
  });
export type SubscriptionUsageQueryDto = z.infer<
  typeof SubscriptionUsageQueryDtoSchema
>;

export const SubscriptionUsageRecordParamsSchema = z
  .object({
    source: SubscriptionUsageSourceSchema,
    recordId: z.string().trim().min(1).max(128),
  })
  .strict();
export type SubscriptionUsageRecordParams = z.infer<
  typeof SubscriptionUsageRecordParamsSchema
>;

export type SubscriptionLegacyClientTimeBasis =
  'legacy-started' | 'legacy-input' | 'legacy-queued' | 'legacy-received';

export interface SubscriptionUsageRecord {
  source: SubscriptionUsageSource;
  recordId: string;
  title: string | null;
  taskType: string;
  status: string;
  userId: string;
  userName: string | null;
  usedAt: string;
  timeBasis:
    | 'participation-start-or-run-queued'
    | 'last-message-or-session-created'
    | SubscriptionLegacyClientTimeBasis;
}

export interface SubscriptionModelConsumption {
  callCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costCNY: number;
  basis: 'compute-usage-ledger';
  sourceFilterApplied: false;
  taskCostAttribution: 'unknown';
}

export interface SubscriptionUsageListResponse {
  items: SubscriptionUsageRecord[];
  members: Array<{ userId: string; userName: string | null }>;
  total: number;
  page: number;
  limit: number;
  scope: 'enterprise' | 'personal';
  period: {
    from: string | null;
    to: string | null;
    timezone: 'Asia/Shanghai';
    bounds: '[from,to)';
  };
  modelConsumption: SubscriptionModelConsumption;
  coverage: {
    preciseClientProtocolMin: 2;
    legacyClientTaskCount: number;
    readableLegacyClientTaskCount: number;
    legacyCountScope: 'subscription-and-user-all-time';
    web: 'strict-billing-session-owner-proof-only';
    limitations: string[];
  };
}

export interface SubscriptionUsageEvent {
  id: string;
  participationId: string;
  clientRunId: string;
  sequence: number;
  type: string;
  stepKey: string | null;
  message: string | null;
  occurredAt: string | null;
  createdAt: string;
}

export interface SubscriptionClientUsageDetail {
  source: 'client';
  recordId: string;
  task: { id: string; clientTaskId: string; title: string; userId: string };
  runs: Array<{
    clientRunId: string;
    queuedAt: string;
    taskType: string;
    protocolVersion: number;
    participations: Array<{
      id: string;
      clientRunId: string;
      executionId: string;
      nodeId: string | null;
      title: string | null;
      subscriptionId: string;
      employeeId: string;
      employeeName: string;
      subscriptionName: string;
      status: string;
      startedAt: string | null;
      completedAt: string | null;
      createdAt: string;
      events: SubscriptionUsageEvent[];
    }>;
  }>;
  coverage: {
    attribution: 'verified-participations-only';
    legacyRunsExcluded: true;
    unassignedEventsExcluded: true;
    taskCost: 'unknown';
  };
}

export interface SubscriptionLegacyClientUsageDetail {
  source: 'client-legacy';
  recordId: string;
  task: { id: string; clientTaskId: string; title: string; userId: string };
  run: {
    clientRunId: string;
    status: string;
    queuedAt: string | null;
    startedAt: string | null;
    completedAt: string | null;
    usedAt: string;
    timeBasis: SubscriptionLegacyClientTimeBasis;
  };
  events: Array<
    Omit<SubscriptionUsageEvent, 'participationId'> & {
      participationId: null;
      progress: number | null;
    }
  >;
  coverage: {
    attribution: 'legacy-root-subscription-unverified';
    currentRunOnly: true;
    taskCost: 'unknown';
  };
}

export interface SubscriptionWebUsageDetail {
  source: 'web-conversation' | 'web-task';
  recordId: string;
  session: {
    id: string;
    title: string | null;
    userId: string;
    employeeId: string;
    createdAt: string;
    source: 'CHAT' | 'TASK';
  };
  messages: Array<{
    id: string;
    role: 'USER' | 'ASSISTANT' | 'TOOL';
    content: string;
    createdAt: string;
  }>;
  coverage: { attribution: 'verified'; taskCost: 'unknown' };
}

export type SubscriptionUsageDetailResponse =
  | SubscriptionClientUsageDetail
  | SubscriptionLegacyClientUsageDetail
  | SubscriptionWebUsageDetail;
