import { z } from 'zod';

export const TaskPlanPreviewDtoSchema = z.object({
  objective: z.string().trim().min(8, '任务目标至少需要 8 个字符').max(4000),
  employeeIds: z.array(z.string().min(1)).max(20).optional(),
});

export type TaskPlanPreviewDto = z.infer<typeof TaskPlanPreviewDtoSchema>;

export const PlannerOutputSchema = z.object({
  summary: z.string().min(1).max(500),
  steps: z.array(z.object({
    employeeId: z.string().min(1),
    capabilityId: z.string().min(1),
    title: z.string().min(1).max(120),
    description: z.string().min(1).max(800),
    rationale: z.string().min(1).max(500),
    dependsOnStepNumbers: z.array(z.number().int().min(1).max(12)).max(11).default([]),
    estimatedSeconds: z.number().int().min(10).transform((seconds) => Math.min(seconds, 3600)).default(120),
  })).min(1).max(12),
});

export type PlannerOutput = z.infer<typeof PlannerOutputSchema>;
