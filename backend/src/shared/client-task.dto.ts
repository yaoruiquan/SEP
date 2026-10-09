import { z } from 'zod';

const clientRunId = z.string().trim().min(1).max(160);
const progress = z.number().int().min(0).max(100).optional();
export const ClientTaskMonitorStatusSchema = z.enum([
  'QUEUED', 'RUNNING', 'WAITING_APPROVAL', 'PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED',
]);
const timestamp = z.string().datetime({ offset: true });

export const CreateClientTaskMirrorDtoSchema = z.object({
  clientTaskId: z.string().trim().min(1).max(160),
  clientRunId,
  subscriptionId: z.string().trim().min(1).max(128),
  title: z.string().trim().min(1).max(200),
  taskType: z.string().trim().min(1).max(64).optional(),
  modelId: z.string().trim().min(1).max(128).optional().nullable(),
  clientVersion: z.string().trim().min(1).max(64).optional().nullable(),
  protocolVersion: z.literal(2).optional(),
  queuedAt: timestamp.optional(),
});
export type CreateClientTaskMirrorDto = z.infer<typeof CreateClientTaskMirrorDtoSchema>;

export const UpdateClientTaskMirrorStatusDtoSchema = z.object({
  clientRunId: clientRunId.optional(),
  status: ClientTaskMonitorStatusSchema,
  progress,
  currentStep: z.string().trim().max(200).optional().nullable(),
  activity: z.string().trim().max(500).optional().nullable(),
  errorSummary: z.string().trim().max(2000).optional().nullable(),
  startedAt: timestamp.optional().nullable(),
  completedAt: timestamp.optional().nullable(),
});
export type UpdateClientTaskMirrorStatusDto = z.infer<typeof UpdateClientTaskMirrorStatusDtoSchema>;

export const ClientTaskHeartbeatDtoSchema = z.object({
  clientRunId: clientRunId.optional(),
  progress,
  currentStep: z.string().trim().max(200).optional().nullable(),
  activity: z.string().trim().max(500).optional().nullable(),
  clientVersion: z.string().trim().max(64).optional().nullable(),
});
export type ClientTaskHeartbeatDto = z.infer<typeof ClientTaskHeartbeatDtoSchema>;

export const ClientTaskParticipationDtoSchema = z.object({
  executionId: z.string().trim().min(1).max(160),
  subscriptionId: z.string().trim().min(1).max(128),
  nodeId: z.string().trim().min(1).max(160).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  modelId: z.string().trim().min(1).max(128).optional().nullable(),
  status: ClientTaskMonitorStatusSchema.optional(),
  startedAt: timestamp.optional(),
  completedAt: timestamp.optional(),
});

export const ClientTaskEventDtoSchema = z.object({
  clientRunId: clientRunId.optional(),
  sequence: z.number().int().positive().max(2147483647),
  type: z.string().trim().min(1).max(64),
  stepKey: z.string().trim().max(160).optional().nullable(),
  // Preserve whitespace across content:v1 chunks; the client redacts before splitting.
  message: z.string().max(1000).optional().nullable(),
  progress,
  occurredAt: timestamp.optional().nullable(),
  participation: ClientTaskParticipationDtoSchema.optional(),
});
export type ClientTaskEventDto = z.infer<typeof ClientTaskEventDtoSchema>;

// Date-only boundaries are midnight UTC+8; timestamps must include an offset.
const queryDate = z.union([
  timestamp,
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(+date) && date.toISOString().slice(0, 10) === value;
  }, 'Invalid calendar date'),
]);
const asDate = (value: string) => new Date(value.length === 10 ? `${value}T00:00:00+08:00` : value);
// Do not default page/limit here: their presence selects the paginated response.
export const ClientTaskMirrorQueryDtoSchema = z.object({
  page: z.coerce.number().int().positive().max(2147483647).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  scope: z.enum(['mine', 'enterprise']).optional(),
  subscriptionId: z.string().trim().min(1).max(128).optional(),
  userId: z.string().trim().min(1).max(128).optional(),
  statuses: z.string().transform(value => value.split(',').map(status => status.trim()))
    .pipe(z.array(ClientTaskMonitorStatusSchema).min(1).max(7)).optional(),
  view: z.enum(['active', 'attention', 'history']).optional(),
  taskType: z.string().trim().min(1).max(64).optional(),
  from: queryDate.optional(),
  to: queryDate.optional(),
  q: z.string().trim().min(1).max(200).optional(),
  sort: z.enum(['queuedAt_desc', 'queuedAt_asc', 'startedAt_desc', 'startedAt_asc', 'updatedAt_desc', 'updatedAt_asc']).optional(),
}).refine(value => !value.from || !value.to || asDate(value.from) < asDate(value.to), {
  message: 'from must be before to', path: ['to'],
});
export type ClientTaskMirrorQueryDto = z.infer<typeof ClientTaskMirrorQueryDtoSchema>;
