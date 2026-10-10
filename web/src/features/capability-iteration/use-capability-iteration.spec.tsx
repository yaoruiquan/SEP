import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api-client';
import {
  capabilityIterationKeys, useSelectEffectiveVersion,
  useIterableCapabilities, usePersonalDiffs, useVersionTimeline,
} from './use-capability-iteration';

vi.mock('@/lib/api-client', () => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
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
beforeEach(() => { vi.clearAllMocks(); vi.mocked(api.get).mockResolvedValue({}); vi.mocked(api.post).mockResolvedValue({}); vi.mocked(api.patch).mockResolvedValue({}); });
afterEach(cleanup);

describe('企业启用 mutation 契约', () => {
  it('企业启用使用技能级接口，无需订阅并刷新所有关联查询', async () => {
    const { wrapper, invalidate, client } = setup();
    const { result } = renderHook(() => useSelectEffectiveVersion('cap'), { wrapper });
    await act(async () => { await result.current.mutateAsync({ versionId: 'enterprise' }); });
    expect(api.post).toHaveBeenCalledExactlyOnceWith('/enterprise/capabilities/cap/default-version', { versionId: 'enterprise' });
    expectInvalidated(invalidate);
    client.clear();
  });

  it('企业启用切换失败不更新查询或回退到订阅接口', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('无管理权限'));
    const { wrapper, invalidate, client } = setup();
    const { result } = renderHook(() => useSelectEffectiveVersion('cap'), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync({ versionId: 'enterprise' })).rejects.toThrow('无管理权限');
    });
    expect(api.post).toHaveBeenCalledExactlyOnceWith('/enterprise/capabilities/cap/default-version', { versionId: 'enterprise' });
    expect(invalidate).not.toHaveBeenCalled();
    client.clear();
  });


});

describe('技能库跨端刷新', () => {
  it.each([
    ['列表', () => useIterableCapabilities(), '/enterprise/capabilities'],
    ['改动', () => usePersonalDiffs('cap'), '/enterprise/capabilities/cap/personal-diffs?page=1&limit=20'],
    ['版本', () => useVersionTimeline('cap'), '/enterprise/capabilities/cap/versions'],
  ] as const)('%s覆盖全局缓存，挂载/聚焦刷新并只在前台轮询', async (_name, hook, path) => {
    const { wrapper, client } = setup();
    client.setDefaultOptions({ queries: { staleTime: 300_000, refetchOnMount: false, refetchOnWindowFocus: false, retry: false } });
    const { result, unmount } = renderHook(() => ({ isSuccess: hook().isSuccess }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.get).toHaveBeenCalledExactlyOnceWith(path);
    expect(client.getQueryCache().getAll()[0].options).toEqual(expect.objectContaining({
      staleTime: 0, refetchOnMount: true, refetchOnWindowFocus: true,
      refetchInterval: 30_000, refetchIntervalInBackground: false,
    }));
    unmount();
    client.clear();
  });
  it('分页和审核状态进入请求与cache key，不在前端分页后筛选', async () => {
    const { client, wrapper } = setup();
    const { result, unmount } = renderHook(() => usePersonalDiffs('cap', true, 3, 'ENTERPRISE_APPROVED'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.get).toHaveBeenCalledExactlyOnceWith('/enterprise/capabilities/cap/personal-diffs?page=3&limit=20&status=ENTERPRISE_APPROVED');
    expect(client.getQueryCache().getAll()[0].queryKey).toEqual([...capabilityIterationKeys.personalDiffs('cap'), { page: 3, limit: 20, status: 'ENTERPRISE_APPROVED' }]);
    unmount();
    client.clear();
  });
});
