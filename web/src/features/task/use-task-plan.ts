'use client';

import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import type { TaskPlan } from './task-orchestration';

export function useCreateTaskPlan() {
  return useMutation({
    mutationFn: (input: { objective: string; employeeIds?: string[] }) =>
      api.post<TaskPlan>('/task-plans/preview', input),
  });
}
