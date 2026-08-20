'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';
import type { Subscription, SubscriptionStatus } from '@/lib/types';

/**
 * 本企业的雇佣关系列表。**需要登录**。
 *
 * 后端不按 status 过滤 —— 已暂停的也要能看到才能恢复它，
 * 只看在岗的场景请在调用处过滤。
 *
 * opts.enabled 用于公开页面（人才市场）—— 访客不该发这个请求：
 * 拿 401 后 api-client 会走一轮 refresh 再 clear，纯属白跑。
 */
export function useSubscriptions(opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: qk.subscriptions,
    queryFn: () => api.get<Subscription[]>('/subscriptions'),
    enabled: opts?.enabled ?? true,
  });
}

/** 读取企业内一条雇佣关系，详情页使用。 */
export function useSubscription(id: string) {
  return useQuery({
    queryKey: ['subscriptions', id],
    queryFn: () => api.get<Subscription>(`/subscriptions/${id}`),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

export function useSubscribe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (employeeId: string) =>
      api.post<Subscription>('/subscriptions', { employeeId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.subscriptions });
      qc.invalidateQueries({ queryKey: qk.employees() });
    },
  });
}

export function useUnsubscribe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/subscriptions/${id}`),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: qk.subscriptions });
      qc.invalidateQueries({ queryKey: qk.myEmployees });
      qc.invalidateQueries({ queryKey: ['subscriptions', id] });
    },
  });
}

/**
 * 修改雇佣关系（自定义称呼 / 配置）。
 *
 * 没有 departmentId —— 收敛后部门差异化由授权记录表达，
 * 雇佣关系本身不挂部门。
 */
export function useUpdateSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: string;
      name?: string | null;
      config?: Record<string, unknown>;
    }) => api.patch<Subscription>(`/subscriptions/${id}`, body),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: qk.subscriptions });
      qc.invalidateQueries({ queryKey: qk.myEmployees });
      qc.invalidateQueries({ queryKey: ['subscriptions', id] });
    },
  });
}

/**
 * 启用 / 暂停 / 解聘。
 * EXPIRED 是终态，转回会被后端拒绝（409）——
 * 前端对已解聘的应禁用操作而非依赖报错提示。
 */
export function useChangeSubscriptionStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: SubscriptionStatus }) =>
      api.patch<{ id: string; status: SubscriptionStatus; changed: boolean }>(
        `/subscriptions/${id}/status`,
        { status },
      ),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: qk.subscriptions });
      // 暂停会让员工从「我的硅基员工」消失，必须一起失效
      qc.invalidateQueries({ queryKey: qk.myEmployees });
      qc.invalidateQueries({ queryKey: ['subscriptions', id] });
    },
  });
}

/** 升级到模板最新版。只改版本号，不迁移 config（决策 14）。 */
export function useUpgradeSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<{
        id: string;
        templateVersion: string;
        from: string;
        to: string;
        configReviewRequired: boolean;
      }>(`/subscriptions/${id}/upgrade`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.subscriptions });
      qc.invalidateQueries({ queryKey: qk.myEmployees });
    },
  });
}

export function useUpdateSubscriptionConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, config }: { id: string; config: Record<string, unknown> }) =>
      api.patch<Subscription>(`/subscriptions/${id}/config`, { config }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.subscriptions });
    },
  });
}
