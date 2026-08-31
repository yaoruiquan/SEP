'use client';

import type { TaskRunStatus } from './task-orchestration';
import type { TaskExecutionStep, TaskRunStepStatus } from './task-execution';

/**
 * 执行状态文案的唯一来源。
 *
 * 措辞一律写成「员工在汇报工作」，主语是人不是节点 —— 这个产品的叙事是雇员工干活，
 * 状态就该读起来像同事跟你说话，而不是流程引擎打日志。
 *
 * `task-step-state.ts` 里规划期（还没跑）的那套文案委托到这里，两边不各写一份。
 */

export type StepTone = 'idle' | 'active' | 'done' | 'failed' | 'paused' | 'skipped';

export interface StepNarration {
  tone: StepTone;
  /** 短标签，用于徽章 */
  label: string;
  /** 一句话工作汇报，主语是员工 */
  detail: string;
  /** 用时 / 预计，没有就是 null */
  timing: string | null;
}

export interface RunNarration {
  tone: 'draft' | 'ready' | 'active' | 'done' | 'failed' | 'stopped';
  label: string;
  detail: string;
  doneCount: number;
  total: number;
  focusStep?: NarratableStep;
}

/** 叙事需要的最小步骤形状。执行步骤与规划步骤都能塞进来。 */
export interface NarratableStep {
  key: string;
  order: number;
  title: string;
  status: TaskRunStepStatus;
  employeeName: string;
  employeeId: string;
  capabilityName: string;
  dependsOn: string[];
  estimatedSeconds: number;
  startedAt: string | null;
  durationMs: number | null;
  output: string | null;
  error: string | null;
}

export const STEP_TONE_BY_STATUS: Record<TaskRunStepStatus, StepTone> = {
  queued: 'idle',
  running: 'active',
  completed: 'done',
  failed: 'failed',
  skipped: 'skipped',
  paused: 'paused',
};

export function toNarratable(step: TaskExecutionStep): NarratableStep {
  return {
    key: step.stepKey,
    order: step.order,
    title: step.title,
    status: step.status,
    employeeName: step.employee.name,
    employeeId: step.employee.id,
    capabilityName: step.capability.name,
    dependsOn: step.dependsOn,
    estimatedSeconds: step.estimatedSeconds,
    startedAt: step.startedAt,
    durationMs: step.durationMs,
    output: step.output,
    error: step.error,
  };
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds} 秒`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds > 0 ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分`;
  const hours = Math.floor(minutes / 60);
  return `${hours} 小时 ${minutes % 60} 分`;
}

function estimateLabel(step: NarratableStep): string | null {
  if (!step.estimatedSeconds || step.estimatedSeconds <= 0) return null;
  if (step.estimatedSeconds < 60) return `预计 ${step.estimatedSeconds} 秒`;
  return `预计 ${Math.ceil(step.estimatedSeconds / 60)} 分钟`;
}

function upstreamNames(step: NarratableStep, steps: NarratableStep[]): string[] {
  return step.dependsOn
    .map((key) => steps.find((candidate) => candidate.key === key)?.employeeName)
    .filter((name): name is string => Boolean(name));
}

export function narrateStep(
  step: NarratableStep,
  ctx: { steps: NarratableStep[]; nowMs?: number },
): StepNarration {
  const now = ctx.nowMs ?? Date.now();

  switch (step.status) {
    case 'running': {
      const elapsed = step.startedAt ? now - new Date(step.startedAt).getTime() : 0;
      return {
        tone: 'active',
        label: '正在工作',
        detail: `${step.employeeName} 正在${step.capabilityName}`,
        timing: elapsed > 1000 ? `已用 ${formatDuration(elapsed)}` : null,
      };
    }
    case 'completed':
      return {
        tone: 'done',
        label: '已交付',
        detail: step.output
          ? `${step.employeeName} 交付了结果`
          : `${step.employeeName} 完成了这一步，没有返回文本`,
        timing: step.durationMs ? `用了 ${formatDuration(step.durationMs)}` : null,
      };
    case 'failed':
      return {
        tone: 'failed',
        label: '卡住了',
        detail: step.error?.trim() || `${step.employeeName} 没能完成这一步`,
        timing: null,
      };
    case 'skipped':
      return { tone: 'skipped', label: '已跳过', detail: '这一步被跳过了', timing: null };
    case 'paused':
      return {
        tone: 'paused',
        label: '已暂停',
        detail: `${step.employeeName} 已停下，等你恢复`,
        timing: null,
      };
    default: {
      // 「等依赖」和「已就位」是两句不同的话：前者要点名在等谁，
      // 否则用户看到一排「候场中」不知道卡在哪。
      const waitingFor = upstreamNames(step, ctx.steps);
      return {
        tone: 'idle',
        label: '候场中',
        detail:
          waitingFor.length > 0
            ? `等 ${waitingFor.join('、')} 交付后开始`
            : `${step.employeeName} 已就位，确认计划后开始`,
        timing: estimateLabel(step),
      };
    }
  }
}

export function narrateRun(status: TaskRunStatus, steps: NarratableStep[]): RunNarration {
  const ordered = [...steps].sort((left, right) => left.order - right.order);
  const total = ordered.length;
  const doneCount = ordered.filter((step) => step.status === 'completed').length;
  const running = ordered.find((step) => step.status === 'running');
  const failed = ordered.find((step) => step.status === 'failed');
  const paused = ordered.find((step) => step.status === 'paused');
  const nextUp = ordered.find((step) => step.status === 'queued');

  if (status === 'running') {
    const focus = running ?? paused ?? nextUp;
    if (!running && paused) {
      return {
        tone: 'active',
        label: '等你放行',
        detail: `${paused.employeeName} 已暂停，恢复后继续`,
        doneCount,
        total,
        focusStep: paused,
      };
    }
    return {
      tone: 'active',
      label: focus ? `第 ${focus.order}/${total} 步进行中` : '正在收尾',
      detail: focus ? `${focus.employeeName} 正在${focus.capabilityName}` : '所有步骤已派出',
      doneCount,
      total,
      focusStep: focus,
    };
  }
  if (status === 'completed') {
    return {
      tone: 'done',
      label: '全部交付完成',
      detail: `${uniqueEmployeeCount(ordered)} 位员工完成了 ${total} 步`,
      doneCount,
      total,
    };
  }
  if (status === 'failed') {
    return {
      tone: 'failed',
      label: failed ? `第 ${failed.order} 步卡住了` : '执行失败',
      detail: failed ? failed.error?.trim() || `${failed.employeeName} 没能完成这一步` : '需要你处理',
      doneCount,
      total,
      focusStep: failed,
    };
  }
  if (status === 'stopped') {
    return {
      tone: 'stopped',
      label: '已停止',
      detail: `已完成 ${doneCount}/${total} 步，可以从中断处继续`,
      doneCount,
      total,
      focusStep: nextUp,
    };
  }
  return {
    tone: status === 'draft' ? 'draft' : 'ready',
    label: '计划已就绪',
    detail: `${uniqueEmployeeCount(ordered)} 位员工 · ${total} 步，确认后开始执行`,
    doneCount,
    total,
    focusStep: ordered[0],
  };
}

function uniqueEmployeeCount(steps: NarratableStep[]): number {
  return new Set(steps.map((step) => step.employeeId)).size;
}
