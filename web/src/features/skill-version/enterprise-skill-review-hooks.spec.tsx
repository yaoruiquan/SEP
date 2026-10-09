import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api-client';
import { useEnterpriseSkillVersionReviews, useReviewEnterprisePersonalSkillVersion, useSelectSkillVersion } from './use-skill-version';

vi.mock('@/lib/api-client', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
const clients: QueryClient[] = [];
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 300_000, refetchOnWindowFocus: false, refetchOnMount: false }, mutations: { retry: false } } });
  clients.push(client);
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper, invalidate };
}
beforeEach(() => { vi.clearAllMocks(); vi.mocked(api.get).mockResolvedValue({ total: 0, items: [], page: 1, limit: 20 }); vi.mocked(api.post).mockResolvedValue({ id: 'v' }); });
afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.clear()); });

describe('旧订阅选版兼容', () => {
  it('原useSelectSkillVersion保留订阅接口及缓存刷新', async () => {
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useSelectSkillVersion('employee'), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ subscriptionId: 'sub', capabilityId: 'cap', versionId: 'enterprise' });
    });
    expect(api.post).toHaveBeenCalledExactlyOnceWith('/enterprise/subscriptions/sub/skills/cap/select-version', { versionId: 'enterprise' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['skill-versions', 'employee', 'employee'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['capability-iteration'] });
  });
});

describe('企业个人技能审核 hooks', () => {
  it('查询传递状态、技能ID及分页，按企业隔离缓存并配置前台轮询', async () => {
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useEnterpriseSkillVersionReviews({ enterpriseId: 'ent', status: 'ENTERPRISE_REJECTED', capabilityId: 'cap', page: 3, limit: 100 }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.get).toHaveBeenCalledExactlyOnceWith('/enterprise/skill-version-reviews?status=ENTERPRISE_REJECTED&page=3&limit=100&capabilityId=cap');
    const query = client.getQueryCache().getAll()[0];
    expect(query.queryKey.slice(0, 3)).toEqual(['skill-versions', 'enterprise-reviews', 'ent']);
    expect(query.options).toEqual(expect.objectContaining({ staleTime: 0, refetchOnMount: true, refetchOnWindowFocus: true, refetchInterval: 30_000, refetchIntervalInBackground: false }));
  });
  it('无权限及无企业身份禁用队列查询', async () => {
    const { wrapper } = setup();
    renderHook(() => useEnterpriseSkillVersionReviews({ enterpriseId: 'ent', status: 'PENDING_ENTERPRISE_REVIEW' }, false), { wrapper });
    renderHook(() => useEnterpriseSkillVersionReviews({ enterpriseId: null, status: 'PENDING_ENTERPRISE_REVIEW' }), { wrapper });
    await act(async () => {});
    expect(api.get).not.toHaveBeenCalled();
  });
  it('切换企业不复用上一企业的队列cache', async () => {
    const { client, wrapper } = setup();
    const { result, rerender } = renderHook(({ enterpriseId }) => useEnterpriseSkillVersionReviews({ enterpriseId, status: 'PENDING_ENTERPRISE_REVIEW' }), { wrapper, initialProps: { enterpriseId: 'ent-a' } });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    rerender({ enterpriseId: 'ent-b' });
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    expect(client.getQueryCache().getAll().map((query) => query.queryKey[2])).toEqual(['ent-a', 'ent-b']);
  });
  it('审核只提交decision/comment，成功失效技能与时间线', async () => {
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useReviewEnterprisePersonalSkillVersion(), { wrapper });
    await act(async () => { await result.current.mutateAsync({ id: 'v', decision: 'REJECT', comment: ' 原因 ' }); });
    expect(api.post).toHaveBeenCalledExactlyOnceWith('/enterprise/skill-versions/v/review', { decision: 'REJECT', comment: '原因' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['skill-versions'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['capability-iteration'] });
  });
  it('共享schema拒绝空原因，未发网络请求或成功缓存失效', async () => {
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useReviewEnterprisePersonalSkillVersion(), { wrapper });
    await act(async () => { await expect(result.current.mutateAsync({ id: 'v', decision: 'REJECT', comment: ' ' })).rejects.toThrow(); });
    expect(api.post).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });
  it('工作副本传递预览时的expectedUpdatedAt，并保留发布回执', async () => {
    const receipt = { id: 'working-copy', status: 'PERSONAL_ACTIVE', publishedVersionId: 'enterprise-new' };
    vi.mocked(api.post).mockResolvedValueOnce(receipt);
    const { wrapper } = setup();
    const { result } = renderHook(() => useReviewEnterprisePersonalSkillVersion(), { wrapper });
    await act(async () => {
      expect(await result.current.mutateAsync({ id: 'working-copy', decision: 'APPROVE', expectedUpdatedAt: '2026-10-09T00:00:00.000Z' })).toEqual(receipt);
    });
    expect(api.post).toHaveBeenCalledExactlyOnceWith('/enterprise/skill-versions/working-copy/review', { decision: 'APPROVE', expectedUpdatedAt: '2026-10-09T00:00:00.000Z' });
  });
  it('历史通过未发布仍复用APPROVE接口', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useReviewEnterprisePersonalSkillVersion(), { wrapper });
    await act(async () => { await result.current.mutateAsync({ id: 'legacy', decision: 'APPROVE' }); });
    expect(api.post).toHaveBeenCalledExactlyOnceWith('/enterprise/skill-versions/legacy/review', { decision: 'APPROVE' });
  });
  it('审核失败不发成功缓存失效，允许人工重试', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('服务不可用'));
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useReviewEnterprisePersonalSkillVersion(), { wrapper });
    await act(async () => { await expect(result.current.mutateAsync({ id: 'v', decision: 'APPROVE' })).rejects.toThrow('服务不可用'); });
    expect(invalidate).not.toHaveBeenCalled();
    expect(api.post).toHaveBeenCalledTimes(1);
  });
});
