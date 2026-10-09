import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api-client';
import {
  capabilityIterationKeys, useCreatePersonalVersion, useSelectEffectiveVersion,
  useSelectPersonalVersion, useUpdatePersonalVersion,
} from './use-capability-iteration';

vi.mock('@/lib/api-client', () => ({ api: { post: vi.fn(), patch: vi.fn() } }));
function setup() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, invalidate, wrapper };
}
function expectInvalidated(invalidate: ReturnType<typeof setup>['invalidate']) {
  for (const queryKey of [capabilityIterationKeys.versions('cap'), capabilityIterationKeys.list(),
    capabilityIterationKeys.personalDiffs('cap'), ['skill-versions']]) {
    expect(invalidate).toHaveBeenCalledWith({ queryKey });
  }
}
beforeEach(() => { vi.clearAllMocks(); vi.mocked(api.post).mockResolvedValue({}); vi.mocked(api.patch).mockResolvedValue({}); });
afterEach(cleanup);

describe('个人选版 mutation 契约', () => {
  it.each([null, 'platform', 'enterprise', 'mine'])('向指定订阅发送 versionId=%s 并刷新所有关联查询', async (versionId) => {
    const { wrapper, invalidate, client } = setup();
    const { result } = renderHook(() => useSelectPersonalVersion('cap'), { wrapper });
    await act(async () => { await result.current.mutateAsync({ subscriptionId: 'sub-b', versionId }); });
    expect(api.post).toHaveBeenCalledExactlyOnceWith('/enterprise/subscriptions/sub-b/skills/cap/select-personal-version', { versionId });
    expectInvalidated(invalidate);
    client.clear();
  });

  it('失败不更新查询，允许重试', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('无使用授权'));
    const { wrapper, invalidate, client } = setup();
    const { result } = renderHook(() => useSelectPersonalVersion('cap'), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync({ subscriptionId: 'sub', versionId: null })).rejects.toThrow('无使用授权');
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidate).not.toHaveBeenCalled();
    client.clear();
  });

  it('企业默认仍使用旧 select-version 接口，不混用个人接口', async () => {
    const { wrapper, client } = setup();
    const { result } = renderHook(() => useSelectEffectiveVersion('cap'), { wrapper });
    await act(async () => { await result.current.mutateAsync({ subscriptionId: 'sub', versionId: 'enterprise' }); });
    expect(api.post).toHaveBeenCalledExactlyOnceWith('/enterprise/subscriptions/sub/skills/cap/select-version', { versionId: 'enterprise' });
    client.clear();
  });

  it('编辑副本仅 PATCH 正文，不隐式发送选版，并刷新预览/时间线', async () => {
    const { wrapper, invalidate, client } = setup();
    const { result } = renderHook(() => useUpdatePersonalVersion('cap'), { wrapper });
    await act(async () => { await result.current.mutateAsync({ versionId: 'mine', content: 'new', changeSummary: '说明' }); });
    expect(api.patch).toHaveBeenCalledExactlyOnceWith('/enterprise/personal-versions/mine', { content: 'new', changeSummary: '说明' });
    expect(api.post).not.toHaveBeenCalled();
    expectInvalidated(invalidate);
    client.clear();
  });

  it('创建/获取副本由后端决定是否激活，不另发个人选版', async () => {
    const { wrapper, invalidate, client } = setup();
    const { result } = renderHook(() => useCreatePersonalVersion('cap'), { wrapper });
    await act(async () => { await result.current.mutateAsync(); });
    expect(api.post).toHaveBeenCalledExactlyOnceWith('/enterprise/capabilities/cap/personal-version', {});
    expectInvalidated(invalidate);
    client.clear();
  });
});
