import type { TaskPlan, TaskPlanStep, TaskStepStatus } from './task-orchestration';

/**
 * 任务状态文案的唯一来源。
 *
 * 重构前有四处各写一套：canvas 的 STATUS_LABELS、StepDetail 里内联的三元链、
 * StepInspectorPanel、以及暂停态那个独立分支。同一个步骤在不同位置显示不同说法。
 *
 * 措辞一律写成「员工在汇报工作」，主语是人不是节点 —— 这个产品的叙事是雇员工干活，
 * 状态就该读起来像同事跟你说话，而不是流程引擎打日志。
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
  /** 正在跑或下一个要跑的步骤 */
  focusStep?: TaskPlanStep;
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

function estimateLabel(step: TaskPlanStep): string | null {
  if (!step.estimatedSeconds || step.estimatedSeconds <= 0) return null;
  if (step.estimatedSeconds < 60) return `预计 ${step.estimatedSeconds} 秒`;
  return `预计 ${Math.ceil(step.estimatedSeconds / 60)} 分钟`;
}

function upstreamNames(step: TaskPlanStep, plan: TaskPlan): string[] {
  return step.dependsOn
    .map((id) => plan.steps.find((candidate) => candidate.id === id)?.employee.name)
    .filter((name): name is string => Boolean(name));
}

export const STEP_TONE_BY_STATUS: Record<TaskStepStatus, StepTone> = {
  queued: 'idle',
  running: 'active',
  completed: 'done',
  failed: 'failed',
  skipped: 'skipped',
};

export function narrateStep(
  step: TaskPlanStep,
  ctx: { plan: TaskPlan; paused?: boolean; nowMs?: number },
): StepNarration {
  const { plan, paused = false } = ctx;
  const now = ctx.nowMs ?? Date.now();

  if (paused && (step.status === 'queued' || step.status === 'running')) {
    return {
      tone: 'paused',
      label: '已暂停',
      detail: `${step.employee.name} 已停下，等你恢复`,
      timing: null,
    };
  }

  switch (step.status) {
    case 'running': {
      const elapsed = step.startedAt ? now - new Date(step.startedAt).getTime() : 0;
      return {
        tone: 'active',
        label: '正在工作',
        detail: `${step.employee.name} 正在${step.capability.name}`,
        timing: elapsed > 1000 ? `已用 ${formatDuration(elapsed)}` : null,
      };
    }
    case 'completed':
      return {
        tone: 'done',
        label: '已交付',
        detail: step.output
          ? `${step.employee.name} 交付了结果`
          : `${step.employee.name} 完成了这一步，没有返回文本`,
        timing: step.durationMs ? `用了 ${formatDuration(step.durationMs)}` : null,
      };
    case 'failed':
      return {
        tone: 'failed',
        label: '卡住了',
        detail: step.error?.trim() || `${step.employee.name} 没能完成这一步`,
        timing: null,
      };
    case 'skipped':
      return { tone: 'skipped', label: '已跳过', detail: '这一步被跳过了', timing: null };
    default: {
      const waitingFor = upstreamNames(step, plan);
      return {
        tone: 'idle',
        label: '候场中',
        detail: waitingFor.length > 0
          ? `等 ${waitingFor.join('、')} 交付后开始`
          : `${step.employee.name} 已就位，确认计划后开始`,
        timing: estimateLabel(step),
      };
    }
  }
}

export function narrateRun(plan: TaskPlan): RunNarration {
  const ordered = [...plan.steps].sort((left, right) => left.order - right.order);
  const total = ordered.length;
  const doneCount = ordered.filter((step) => step.status === 'completed').length;
  const running = ordered.find((step) => step.status === 'running');
  const failed = ordered.find((step) => step.status === 'failed');
  const nextUp = ordered.find((step) => step.status === 'queued');

  if (plan.status === 'running') {
    const focus = running ?? nextUp;
    return {
      tone: 'active',
      label: focus ? `第 ${focus.order}/${total} 步进行中` : '正在收尾',
      detail: focus ? `${focus.employee.name} 正在${focus.capability.name}` : '所有步骤已派出',
      doneCount,
      total,
      focusStep: focus,
    };
  }
  if (plan.status === 'completed') {
    return {
      tone: 'done',
      label: '全部交付完成',
      detail: `${uniqueEmployeeCount(ordered)} 位员工完成了 ${total} 步`,
      doneCount,
      total,
    };
  }
  if (plan.status === 'failed') {
    return {
      tone: 'failed',
      label: failed ? `第 ${failed.order} 步卡住了` : '执行失败',
      detail: failed ? (failed.error?.trim() || `${failed.employee.name} 没能完成这一步`) : '需要你处理',
      doneCount,
      total,
      focusStep: failed,
    };
  }
  if (plan.status === 'stopped') {
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
    tone: plan.status === 'draft' ? 'draft' : 'ready',
    label: '计划已就绪',
    detail: `${uniqueEmployeeCount(ordered)} 位员工 · ${total} 步，确认后开始执行`,
    doneCount,
    total,
    focusStep: ordered[0],
  };
}

function uniqueEmployeeCount(steps: TaskPlanStep[]): number {
  return new Set(steps.map((step) => step.employee.id)).size;
}

/** 去重后的参与员工，按首次出现顺序 */
export function participatingEmployees(plan: TaskPlan) {
  const seen = new Map<string, TaskPlanStep['employee']>();
  for (const step of [...plan.steps].sort((left, right) => left.order - right.order)) {
    if (!seen.has(step.employee.id)) seen.set(step.employee.id, step.employee);
  }
  return [...seen.values()];
}
