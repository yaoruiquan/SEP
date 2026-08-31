'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';
import { streamTaskExecution } from '@/lib/sse';
import type {
  TaskExecutionEvent,
  TaskExecutionSnapshot,
  TaskExecutionStep,
  TaskStreamFrame,
} from './task-execution';
import { EMPTY_EXECUTION_STATE, executionReducer } from './task-execution-reducer';

/** 重连退避：立刻 → 1s → 2s → 4s → 8s（上限），避免后端重启时被打爆 */
const RECONNECT_DELAYS_MS = [0, 1000, 2000, 4000, 8000];


/**
 * 订阅一个任务运行的执行状态。
 *
 * 前端不再驱动执行 —— 它只是个观察者。因此「关掉标签页」「刷新」「换台机器打开」
 * 三件事在这里是等价的：重新连上就能看到当前真实进度。
 */
export function useTaskExecution(taskRunId: string | undefined) {
  const [state, dispatch] = useReducer(executionReducer, EMPTY_EXECUTION_STATE);
  const queryClient = useQueryClient();
  const attemptRef = useRef(0);

  useEffect(() => {
    if (!taskRunId) {
      dispatch({ kind: 'reset' });
      return;
    }

    dispatch({ kind: 'reset' });
    attemptRef.current = 0;

    let disposed = false;
    let controller: AbortController | null = null;
    let timer: number | undefined;

    // 历史流水单独拉一次：SSE 只推新事件，不重放已发生的
    void api
      .get<TaskExecutionEvent[]>(`/tasks/${taskRunId}/events`)
      .then((events) => {
        if (!disposed) dispatch({ kind: 'events', events });
      })
      .catch(() => undefined);

    const connect = async () => {
      if (disposed) return;
      controller = new AbortController();

      try {
        for await (const message of streamTaskExecution(taskRunId, controller.signal)) {
          if (disposed) return;
          attemptRef.current = 0;
          dispatch({ kind: 'connected', connected: true });
          dispatch({ kind: 'frame', frame: message.data as TaskStreamFrame });
        }
      } catch (error) {
        if (disposed || controller.signal.aborted) return;
        dispatch({
          kind: 'error',
          error: error instanceof Error ? error.message : '执行流连接中断',
        });
      }

      if (disposed) return;
      dispatch({ kind: 'connected', connected: false });

      // 服务端主动结束流（进程重启、代理超时）后自动接回。
      // 任务在服务端照样在跑，断的只是这条观察通道。
      const delay = RECONNECT_DELAYS_MS[Math.min(attemptRef.current, RECONNECT_DELAYS_MS.length - 1)];
      attemptRef.current += 1;
      timer = window.setTimeout(() => void connect(), delay);
    };

    void connect();

    return () => {
      disposed = true;
      controller?.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [taskRunId]);

  // 运行进入终态时刷新列表缓存，历史抽屉里的进度条才会跟着走
  const status = state.snapshot?.status;
  useEffect(() => {
    if (!status || status === 'running') return;
    void queryClient.invalidateQueries({ queryKey: qk.taskRuns });
  }, [status, queryClient]);

  const orderedSteps = useMemo(
    () => [...(state.snapshot?.steps ?? [])].sort((left, right) => left.order - right.order),
    [state.snapshot],
  );

  /**
   * 手动重取快照。
   *
   * 编辑计划（换人 / 删步骤 / 断依赖）走的是 `PATCH /tasks/:id`，服务端在下一次
   * 读执行视图时才把步骤行同步过来（`reconcileWithPlan`）。SSE 只在建连时推全量，
   * 所以编辑后必须主动拉一次，否则「改了没生效」。
   */
  const refresh = useCallback(async () => {
    if (!taskRunId) return;
    try {
      const snapshot = await api.get<TaskExecutionSnapshot>(`/tasks/${taskRunId}/execution`);
      dispatch({ kind: 'frame', frame: { type: 'snapshot', snapshot } });
    } catch {
      // 拉不到就保持现状，SSE 重连时还会推一次全量
    }
  }, [taskRunId]);

  return { ...state, orderedSteps, refresh };
}

// ── 指令 ──────────────────────────────────────────────────────────────────────

function useExecutionMutation<TVars>(
  request: (vars: TVars) => Promise<TaskExecutionSnapshot | unknown>,
  taskRunId: string | undefined,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: () => {
      if (taskRunId) void queryClient.invalidateQueries({ queryKey: qk.taskRun(taskRunId) });
      void queryClient.invalidateQueries({ queryKey: qk.taskRuns });
    },
  });
}

/** 确认计划并在服务端开始执行。可选 fromStepKey 表示从某一步重跑。 */
export function useRunTask(taskRunId: string | undefined) {
  return useExecutionMutation<{ fromStepKey?: string } | void>(
    (vars) =>
      api.post<TaskExecutionSnapshot>(
        `/tasks/${taskRunId}/run`,
        vars && 'fromStepKey' in vars && vars.fromStepKey ? { fromStepKey: vars.fromStepKey } : {},
      ),
    taskRunId,
  );
}

export function useStopTask(taskRunId: string | undefined) {
  return useExecutionMutation<void>(
    () => api.post<TaskExecutionSnapshot>(`/tasks/${taskRunId}/stop`, {}),
    taskRunId,
  );
}

export function usePauseStep(taskRunId: string | undefined) {
  return useExecutionMutation<string>(
    (stepKey) => api.post(`/tasks/${taskRunId}/steps/${stepKey}/pause`, {}),
    taskRunId,
  );
}

export function useResumeStep(taskRunId: string | undefined) {
  return useExecutionMutation<string>(
    (stepKey) => api.post(`/tasks/${taskRunId}/steps/${stepKey}/resume`, {}),
    taskRunId,
  );
}

export interface StepConversation {
  step: TaskExecutionStep;
  messages: Array<{
    id: string;
    role: 'USER' | 'ASSISTANT' | 'TOOL';
    content: string;
    modelId: string | null;
    createdAt: string;
  }>;
}

/**
 * 某一步的完整对话（会议：「每一步结果均可查看」不止是最后那段文本）。
 *
 * stepKey 作为 mutate 的参数而不是 hook 的入参 —— 用户会连着点开好几步的对话，
 * 每次都换一个 hook 实例会把上一次的结果连带清掉。
 */
export function useStepConversation(taskRunId: string | undefined) {
  return useMutation({
    mutationFn: (stepKey: string) =>
      api.get<StepConversation>(`/tasks/${taskRunId}/steps/${stepKey}/messages`),
  });
}

/** 手动刷新执行快照（用于「重新检查」这类兜底按钮） */
export function useRefreshExecution() {
  return useCallback(
    (taskRunId: string) => api.get<TaskExecutionSnapshot>(`/tasks/${taskRunId}/execution`),
    [],
  );
}
