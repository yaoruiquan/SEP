import { z } from 'zod';

const clientRunId = z.string().trim().min(1).max(160);
const progress = z.number().int().min(0).max(100).optional();

export const CreateClientTaskMirrorDtoSchema = z.object({
  clientTaskId: z.string().trim().min(1).max(160),
  clientRunId,
  subscriptionId: z.string().trim().min(1).max(128),
  title: z.string().trim().min(1).max(200),
  taskType: z.string().trim().min(1).max(64).optional(),
  modelId: z.string().trim().min(1).max(128).optional().nullable(),
  clientVersion: z.string().trim().min(1).max(64).optional().nullable(),
});
export type CreateClientTaskMirrorDto = z.infer<typeof CreateClientTaskMirrorDtoSchema>;

export const UpdateClientTaskMirrorStatusDtoSchema = z.object({
  clientRunId: clientRunId.optional(),
  status: z.enum(['QUEUED', 'RUNNING', 'WAITING_APPROVAL', 'PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED']),
  progress,
  currentStep: z.string().trim().max(200).optional().nullable(),
  activity: z.string().trim().max(500).optional().nullable(),
  errorSummary: z.string().trim().max(2000).optional().nullable(),
  startedAt: z.string().datetime().optional().nullable(),
  completedAt: z.string().datetime().optional().nullable(),
});
export type UpdateClientTaskMirrorStatusDto = z.infer<typeof UpdateClientTaskMirrorStatusDtoSchema>;

export const ClientTaskHeartbeatDtoSchema = z.object({
  progress,
  currentStep: z.string().trim().max(200).optional().nullable(),
  activity: z.string().trim().max(500).optional().nullable(),
  clientVersion: z.string().trim().max(64).optional().nullable(),
});
export type ClientTaskHeartbeatDto = z.infer<typeof ClientTaskHeartbeatDtoSchema>;

export const ClientTaskEventDtoSchema = z.object({
  clientRunId: clientRunId.optional(),
  sequence: z.number().int().positive(),
  type: z.string().trim().min(1).max(64),
  stepKey: z.string().trim().max(160).optional().nullable(),
  // Preserve whitespace across content:v1 chunks; the client redacts before splitting.
  message: z.string().max(1000).optional().nullable(),
  progress,
  occurredAt: z.string().datetime().optional().nullable(),
});
export type ClientTaskEventDto = z.infer<typeof ClientTaskEventDtoSchema>;

// Do not default page/limit here: their presence selects the paginated response.
export const ClientTaskMirrorQueryDtoSchema = z.object({
  page: z.coerce.number().int().positive().max(2147483647).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  scope: z.enum(['mine', 'enterprise']).optional(),
});
export type ClientTaskMirrorQueryDto = z.infer<typeof ClientTaskMirrorQueryDtoSchema>;
