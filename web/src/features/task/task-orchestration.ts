import type { CapabilityType } from '@/lib/types';

export type TaskStepStatus = 'queued' | 'running' | 'completed' | 'failed' | 'skipped';
export type TaskRunStatus = 'draft' | 'awaiting_confirmation' | 'running' | 'completed' | 'failed' | 'stopped';

export interface TaskCandidateCapability {
  id: string;
  name: string;
  description: string;
  type: CapabilityType;
}

export interface TaskCandidateEmployee {
  id: string;
  name: string;
  description: string;
  position: string;
  industry: string;
  avatar: string | null;
  capabilities: TaskCandidateCapability[];
}

export interface TaskPlanStep {
  id: string;
  order: number;
  title: string;
  description: string;
  intent: string;
  employee: TaskCandidateEmployee;
  capability: TaskCandidateCapability;
  dependsOn: string[];
  rationale: string;
  estimatedSeconds: number;
  status: TaskStepStatus;
  progress: number;
  output?: string;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
}

export interface TaskPlan {
  id: string;
  objective: string;
  summary: string;
  steps: TaskPlanStep[];
  status: TaskRunStatus;
  createdAt: string;
  planner?: {
    type: 'llm';
    model: string;
  };
}

export interface TaskExecutionEvent {
  id: string;
  stepId: string;
  type: 'plan' | 'employee_selected' | 'capability_started' | 'capability_completed' | 'output' | 'error';
  message: string;
  createdAt: string;
}
