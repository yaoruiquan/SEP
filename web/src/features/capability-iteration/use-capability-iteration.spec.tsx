import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '@/lib/api-client';
import { useAuthStore } from '@/lib/auth-store';
import {
  capabilityIterationKeys, useSelectEffectiveVersion,
  useIterableCapabilities, usePersonalDiffs, useSkillSubmissionDetail, useVersionTimeline,
} from './use-capability-iteration';

vi.mock('@/lib/api-client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api-client')>();
  return { ...original, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } };
});
const clients: QueryClient[] = [];
function setup() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  clients.push(client);
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, invalidate, wrapper };
}
function expectInvalidated(invalidate: ReturnType<typeof setup>['invalidate']) {
  for (const queryKey of [capabilityIterationKeys.versions('cap'), capabilityIterationKeys.list(),
    capabilityIterationKeys.personalDiffs('cap'), capabilityIterationKeys.submissions('cap'), ['skill-versions']]) {
    expect(invalidate).toHaveBeenCalledWith({ queryKey });
  }
}
beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({
    enterprise: { id: 'ent', name: '测试企业' },
    user: { id: 'admin', name: '管理员', email: 'admin@example.test', avatar: null, role: 'USER' },
    roleInEnterprise: 'ENTERPRISE_ADMIN',
  });
  vi.mocked(api.get).mockResolvedValue({});
  vi.mocked(api.post).mockResolvedValue({});
  vi.mocked(api.patch).mockResolvedValue({});
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  useAuthStore.setState({ user: null, enterprise: null, roleInEnterprise: null });
});

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

describe('提交详情权限与缓存契约', () => {
  it('详情使用技能级接口与身份key，并覆盖全局缓存和重试配置', async () => {
    const detail = { canManage: true, item: { id: 'sub-1', content: '管理员可查看正文' } };
    vi.mocked(api.get).mockResolvedValue(detail);
    const { wrapper, client } = setup();
    client.setDefaultOptions({ queries: { staleTime: 300_000, refetchOnMount: false, refetchOnWindowFocus: false, retry: 3 } });
    const { result } = renderHook(() => useSkillSubmissionDetail('cap', 'sub-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(detail);
    expect(api.get).toHaveBeenCalledExactlyOnceWith('/enterprise/capabilities/cap/submissions/sub-1');
    const query = client.getQueryCache().getAll()[0];
    expect(query.queryKey).toEqual(['capability-iteration', 'submissions', 'cap', 'ent:admin:ENTERPRISE_ADMIN', 'sub-1']);
    expect(query.options).toEqual(expect.objectContaining({
      staleTime: 0, refetchOnMount: true, refetchOnWindowFocus: true,
      refetchInterval: 30_000, refetchIntervalInBackground: false, retry: false,
    }));
  });

  it.each([
    ['企业', { enterprise: { id: 'other-ent', name: '其他企业' } }, 'other-ent:admin:ENTERPRISE_ADMIN'],
    ['用户', { user: { id: 'member', name: '成员', email: 'member@example.test', avatar: null, role: 'USER' } }, 'ent:member:ENTERPRISE_ADMIN'],
    ['角色', { roleInEnterprise: 'MEMBER' }, 'ent:admin:MEMBER'],
  ] as const)('%s变化不能复用管理员详情缓存，403不泄漏旧正文也不重试', async (_label, identity, key) => {
    const { wrapper, client } = setup();
    client.setDefaultOptions({ queries: { retry: 3, retryDelay: 0 } });
    const privilegedDetail = { canManage: true, item: { id: 'sub-1', content: '保密正文' } };
    const error = new ApiError(403, '无查看权限');
    vi.mocked(api.get).mockResolvedValueOnce(privilegedDetail).mockRejectedValue(error);
    const { result } = renderHook(() => useSkillSubmissionDetail('cap', 'sub-1'), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(privilegedDetail));
    act(() => { useAuthStore.setState(identity); });
    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBe(error);
    expect(result.current.data).toBeUndefined();
    expect(result.current.failureCount).toBe(1);
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(client.getQueryData(['capability-iteration', 'submissions', 'cap', 'ent:admin:ENTERPRISE_ADMIN', 'sub-1'])).toEqual(privilegedDetail);
    expect(client.getQueryData(['capability-iteration', 'submissions', 'cap', key, 'sub-1'])).toBeUndefined();
  });

  it.each([null, ''])('submissionId为%s时禁用，不请求详情', (submissionId) => {
    const { wrapper, client } = setup();
    const { result } = renderHook(() => useSkillSubmissionDetail('cap', submissionId), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(api.get).not.toHaveBeenCalled();
    expect(client.getQueryCache().getAll()[0].queryKey).toEqual([
      'capability-iteration', 'submissions', 'cap', 'ent:admin:ENTERPRISE_ADMIN', submissionId,
    ]);
  });

  it('没有capabilityId时也不发出详情请求', () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useSkillSubmissionDetail('', 'sub-1'), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(api.get).not.toHaveBeenCalled();
  });

  it('启用版本使不同身份和提交ID的详情缓存同时失效，仅限当前技能', async () => {
    const { wrapper, client, invalidate } = setup();
    const keys = [
      ['capability-iteration', 'submissions', 'cap', 'ent:admin:ENTERPRISE_ADMIN', 'sub-1'],
      ['capability-iteration', 'submissions', 'cap', 'ent:member:MEMBER', 'sub-2'],
    ];
    const otherKey = ['capability-iteration', 'submissions', 'other-cap', 'ent:admin:ENTERPRISE_ADMIN', 'sub-1'];
    for (const key of [...keys, otherKey]) client.setQueryData(key, { item: { id: key[4] } });
    const { result } = renderHook(() => useSelectEffectiveVersion('cap'), { wrapper });
    await act(async () => { await result.current.mutateAsync({ versionId: 'enterprise' }); });
    expectInvalidated(invalidate);
    for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    expect(client.getQueryState(otherKey)?.isInvalidated).toBe(false);
  });
});

describe('技能库跨端刷新', () => {
  it.each([
    ['列表', () => useIterableCapabilities(), ['capability-iteration', 'list']],
    ['版本', () => useVersionTimeline('cap'), ['capability-iteration', 'versions', 'cap']],
    ['改动', () => usePersonalDiffs('cap'), ['capability-iteration', 'personal-diffs', 'cap', { page: 1, limit: 20, status: undefined }]],
  ] as const)('%s角色切换时立即清空旧数据，不用placeholder保留管理员结果', async (_label, hook, prefix) => {
    const { wrapper, client } = setup();
    const adminData = { canManage: true, items: [{ id: 'other-user-submission', content: '其他成员私有正文' }] };
    const memberData = { canManage: false, items: [] };
    let resolveMember!: (value: typeof memberData) => void;
    const memberRequest = new Promise<typeof memberData>((resolve) => { resolveMember = resolve; });
    vi.mocked(api.get).mockResolvedValueOnce(adminData).mockReturnValueOnce(memberRequest);
    const { result } = renderHook(() => hook().data, { wrapper });
    await waitFor(() => expect(result.current).toEqual(adminData));
    act(() => { useAuthStore.setState({ roleInEnterprise: 'MEMBER' }); });
    expect(result.current).toBeUndefined();
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    expect(result.current).toBeUndefined();
    expect(client.getQueryData([...prefix, 'ent:admin:ENTERPRISE_ADMIN'])).toEqual(adminData);
    expect(client.getQueryData([...prefix, 'ent:admin:MEMBER'])).toBeUndefined();
    await act(async () => { resolveMember(memberData); await memberRequest; });
    await waitFor(() => expect(result.current).toEqual(memberData));
    expect(client.getQueryData([...prefix, 'ent:admin:MEMBER'])).toEqual(memberData);
  });

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
    expect(client.getQueryCache().getAll()[0].queryKey).toEqual([...capabilityIterationKeys.personalDiffs('cap'), { page: 3, limit: 20, status: 'ENTERPRISE_APPROVED' }, 'ent:admin:ENTERPRISE_ADMIN']);
    unmount();
    client.clear();
  });
});
