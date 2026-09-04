import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { SseEvent } from '@/lib/sse';
import { useChatStream } from './use-chat-stream';

/**
 * 这组用例锁的是**算力闸门在流上的三种结局**，别的事件类型由更上层的组件测试覆盖。
 *
 * 三种结局必须互不混淆：
 *   · 被拦下  → 弹窗 + 消息没落库（返回 failed，把文字还给用户）
 *   · 改道自费 → 提示 + 本轮照常出结果（返回 ok）
 *   · 别的错误 → 红字，但用户消息**已经**落库了（仍返回 ok，清输入框才对）
 */

const frames = vi.hoisted(() => ({ current: [] as SseEvent[] }));

vi.mock('@/lib/sse', () => ({
  streamMessage: async function* () {
    for (const f of frames.current) yield f;
  },
}));

function blockedFrame(over: Record<string, unknown> = {}): SseEvent {
  return {
    event: 'error',
    data: {
      message: '你本月的算力额度已用完，个人余额也已用尽。额度将于 2026年10月1日 重置；',
      code: 'COMPUTE_BLOCKED',
      blockedBy: 'ALLOWANCE',
      personalBalanceCNY: '0.00',
      ...over,
    },
  };
}

async function run(list: SseEvent[]) {
  frames.current = list;
  const onDone = vi.fn();
  const hook = renderHook(() => useChatStream());
  let outcome: string | undefined;
  await act(async () => {
    outcome = await hook.result.current.send('c1', '你好', undefined, onDone);
  });
  return { hook, onDone, outcome };
}

describe('useChatStream —— 算力闸门', () => {
  beforeEach(() => {
    frames.current = [];
  });

  it('❗被拦下时返回 failed —— 消息没落库，输入框必须还原', async () => {
    const { hook, onDone, outcome } = await run([blockedFrame()]);

    expect(outcome).toBe('failed');
    // onDone 会去 refetch 历史并清空输入框，这条消息根本没发出去，不能触发
    expect(onDone).not.toHaveBeenCalled();
    expect(hook.result.current.state.streaming).toBe(false);
  });

  it('被拦下时同时给弹窗信息和气泡红字', async () => {
    const { hook } = await run([blockedFrame()]);

    const { state } = hook.result.current;
    expect(state.blocked).toEqual({
      message: expect.stringContaining('额度将于'),
      blockedBy: 'ALLOWANCE',
      personalBalanceCNY: '0.00',
    });
    // 弹窗关掉后气泡区仍要留下「这条没发出去」的痕迹
    expect(state.error).toBe(state.blocked!.message);
  });

  it('blockedBy 缺失或非法时按 BALANCE 处理，不猜成额度问题', async () => {
    const { hook } = await run([blockedFrame({ blockedBy: undefined })]);
    expect(hook.result.current.state.blocked?.blockedBy).toBe('BALANCE');
  });

  it('❗改道自费是 notice：返回 ok、不弹窗、不报错', async () => {
    const { hook, onDone, outcome } = await run([
      {
        event: 'notice',
        data: {
          message: '你本月的算力额度已用完，本次对话将由你的个人余额支付（当前 ¥8.00）。',
          code: 'COMPUTE_SELF_PAID',
        },
      },
      { event: 'text_delta', data: '好的' },
      { event: 'done', data: { messageId: 'a-1', toolCalls: [] } },
    ]);

    expect(outcome).toBe('ok');
    expect(onDone).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'a-1', text: '好的' }),
    );
    const { state } = hook.result.current;
    expect(state.notice).toContain('个人余额支付');
    expect(state.blocked).toBeNull();
    expect(state.error).toBeNull();
    expect(state.text).toBe('好的');
  });

  it('非算力错误照旧：红字但不弹窗，仍按已落库处理', async () => {
    const { hook, onDone, outcome } = await run([
      { event: 'error', data: { message: '模型调用失败' } },
    ]);

    expect(outcome).toBe('ok');
    expect(onDone).toHaveBeenCalled();
    expect(hook.result.current.state.error).toBe('模型调用失败');
    expect(hook.result.current.state.blocked).toBeNull();
  });

  it('后续的非算力错误不会把还没关的弹窗抹掉', async () => {
    const { hook } = await run([
      blockedFrame(),
      { event: 'error', data: { message: '连接中断' } },
    ]);

    expect(hook.result.current.state.blocked).not.toBeNull();
    expect(hook.result.current.state.error).toBe('连接中断');
  });

  it('dismissBlocked 只关弹窗，红字留在气泡区', async () => {
    const { hook } = await run([blockedFrame()]);

    act(() => hook.result.current.dismissBlocked());

    expect(hook.result.current.state.blocked).toBeNull();
    expect(hook.result.current.state.error).toContain('额度将于');
  });

  it('❗下一次发送先清掉上一轮的弹窗与提示，不留幽灵弹窗', async () => {
    const { hook } = await run([blockedFrame()]);
    expect(hook.result.current.state.blocked).not.toBeNull();

    frames.current = [{ event: 'done', data: { toolCalls: [] } }];
    await act(async () => {
      await hook.result.current.send('c1', '再试一次');
    });

    expect(hook.result.current.state.blocked).toBeNull();
    expect(hook.result.current.state.notice).toBeNull();
    expect(hook.result.current.state.error).toBeNull();
  });
});
