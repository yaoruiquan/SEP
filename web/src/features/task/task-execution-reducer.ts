'use client';

import type {
  LiveStepTool,
  TaskExecutionEvent,
  TaskExecutionSnapshot,
  TaskExecutionStep,
  TaskStreamFrame,
} from './task-execution';

export interface ExecutionState {
  snapshot: TaskExecutionSnapshot | null;
  events: TaskExecutionEvent[];
  /** 正在生成中的文本，按 stepKey 累加。步骤落库后被 step_output 覆盖并清空 */
  liveText: Record<string, string>;
  liveTools: Record<string, LiveStepTool[]>;
  connected: boolean;
  error: string | null;
}

export const EMPTY_EXECUTION_STATE: ExecutionState = {
  snapshot: null,
  events: [],
  liveText: {},
  liveTools: {},
  connected: false,
  error: null,
};

export type ExecutionAction =
  | { kind: 'reset' }
  | { kind: 'frame'; frame: TaskStreamFrame }
  | { kind: 'events'; events: TaskExecutionEvent[] }
  | { kind: 'connected'; connected: boolean }
  | { kind: 'error'; error: string | null };

function patchStep(
  snapshot: TaskExecutionSnapshot | null,
  stepKey: string,
  patch: Partial<TaskExecutionStep>,
): TaskExecutionSnapshot | null {
  if (!snapshot) return snapshot;
  return {
    ...snapshot,
    steps: snapshot.steps.map((step) => (step.stepKey === stepKey ? { ...step, ...patch } : step)),
  };
}

/**
 * 把 SSE 帧折进本地状态。
 *
 * 单独成纯函数是因为帧的到达顺序不完全可控（跨实例经 Redis 转发，重连后还会
 * 收到一份新的全量快照）。把「怎么合并」和「怎么连接」分开后，顺序相关的
 * 行为可以单独测 —— 这类 bug 在真实网络下极难复现。
 */
export function executionReducer(state: ExecutionState, action: ExecutionAction): ExecutionState {
  switch (action.kind) {
    case 'reset':
      return EMPTY_EXECUTION_STATE;
    case 'events':
      return { ...state, events: action.events };
    case 'connected':
      return { ...state, connected: action.connected };
    case 'error':
      return { ...state, error: action.error };
    case 'frame':
      return applyFrame(state, action.frame);
    default:
      return state;
  }
}

function applyFrame(state: ExecutionState, frame: TaskStreamFrame): ExecutionState {
  switch (frame.type) {
    case 'snapshot':
      // 全量到达时清掉累加的增量：库里的 output 才是权威。
      // 保留旧增量会让已完成的步骤显示出「多写了一截」的幻影。
      return { ...state, snapshot: frame.snapshot, liveText: {}, error: null };

    case 'run_status':
      return state.snapshot
        ? {
            ...state,
            snapshot: {
              ...state.snapshot,
              status: frame.status,
              startedAt: frame.startedAt ?? state.snapshot.startedAt,
              completedAt: frame.completedAt,
            },
          }
        : state;

    case 'step_status': {
      const patch: Partial<TaskExecutionStep> = { status: frame.status };
      if (frame.startedAt !== undefined) patch.startedAt = frame.startedAt;
      if (frame.completedAt !== undefined) patch.completedAt = frame.completedAt;
      if (frame.durationMs !== undefined) patch.durationMs = frame.durationMs;
      if (frame.error !== undefined) patch.error = frame.error;
      if (frame.attempt !== undefined) patch.attempt = frame.attempt;
      if (frame.sessionId !== undefined) patch.sessionId = frame.sessionId;

      // 重新开跑（running）或退回排队时清掉上一轮的实时文本与工具，
      // 否则重试的步骤会带着旧内容开始，看起来像没重试
      const resetLive = frame.status === 'running' || frame.status === 'queued';
      return {
        ...state,
        snapshot: patchStep(state.snapshot, frame.stepKey, patch),
        liveText: resetLive ? { ...state.liveText, [frame.stepKey]: '' } : state.liveText,
        liveTools: resetLive ? { ...state.liveTools, [frame.stepKey]: [] } : state.liveTools,
      };
    }

    case 'step_delta':
      return {
        ...state,
        liveText: {
          ...state.liveText,
          [frame.stepKey]: (state.liveText[frame.stepKey] ?? '') + frame.delta,
        },
      };

    case 'step_output':
      return {
        ...state,
        snapshot: patchStep(state.snapshot, frame.stepKey, { output: frame.output }),
        liveText: { ...state.liveText, [frame.stepKey]: '' },
      };

    case 'step_input':
      return {
        ...state,
        snapshot: patchStep(state.snapshot, frame.stepKey, {
          inputPrompt: frame.inputPrompt,
          handoff: frame.handoff,
        }),
      };

    case 'tool': {
      const existing = state.liveTools[frame.stepKey] ?? [];
      const next =
        frame.phase === 'start'
          ? [...existing, { name: frame.name, status: 'running' as const }]
          : existing.map((tool, index) =>
              index === existing.length - 1 && tool.status === 'running'
                ? {
                    ...tool,
                    status: 'done' as const,
                    success: frame.success,
                    durationMs: frame.durationMs,
                  }
                : tool,
            );
      return { ...state, liveTools: { ...state.liveTools, [frame.stepKey]: next } };
    }

    case 'event': {
      // 同一条事件可能因重连后补拉历史而重复，按 id 去重
      if (state.events.some((event) => event.id === frame.event.id)) return state;
      return { ...state, events: [...state.events, frame.event] };
    }

    case 'deliverable':
      return state.snapshot
        ? {
            ...state,
            snapshot: {
              ...state.snapshot,
              deliverable: frame.deliverable,
              deliverableDegraded: frame.degraded,
              deliverableGeneratedAt: frame.generatedAt,
            },
          }
        : state;

    case 'ping':
      return state.snapshot
        ? { ...state, snapshot: { ...state.snapshot, heartbeatAt: frame.heartbeatAt } }
        : state;

    default:
      return state;
  }
}
