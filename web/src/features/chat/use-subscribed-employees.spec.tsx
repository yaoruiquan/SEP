import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { qk } from '@/lib/query-keys';
import { useSubscribedEmployees } from './use-subscribed-employees';
import { useSubscriptions } from '@/features/subscription/use-subscriptions';

vi.mock('@/lib/api-client', () => ({
  api: { get: vi.fn() },
}));

import { api } from '@/lib/api-client';

const mockGet = vi.mocked(api.get);

/** 后端 /subscriptions 的真实形状：订阅对象里嵌 employee */
function subscription(employeeId: string, name: string) {
  return {
    id: `sub-${employeeId}`,
    status: 'ACTIVE',
    employee: {
      id: employeeId,
      name,
      avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${employeeId}`,
      industry: '通用',
      position: '专家',
    },
  };
}

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function freshClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

describe('useSubscribedEmployees', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('缓存键隔离（回归：头像变 ? 的根因）', () => {
    /**
     * 原来两个 hook 共用 qk.subscriptions，但返回形状不同：
     * useSubscriptions 给订阅对象，useSubscribedEmployees 给拍平的员工对象。
     * 同 key 不同形状 → 谁先写缓存谁赢，另一方读到缺字段的对象：
     * 头像取不到变 ?，id 变成订阅 id 导致去重失效、发消息路由到错员工。
     */
    it('两个 hook 的缓存键必须不同', () => {
      expect(qk.subscribedEmployees).not.toEqual(qk.subscriptions);
    });

    it('同时挂载两个 hook，各自拿到自己形状的数据', async () => {
      const raw = [subscription('emp-1', '定价专家'), subscription('emp-2', '选品专家')];
      mockGet.mockResolvedValue(raw);

      const client = freshClient();
      const w = wrapper(client);

      const employees = renderHook(() => useSubscribedEmployees(), { wrapper: w });
      const subs = renderHook(() => useSubscriptions(), { wrapper: w });

      await waitFor(() => {
        expect(employees.result.current.isSuccess).toBe(true);
        expect(subs.result.current.isSuccess).toBe(true);
      });

      // 拍平后的员工形状：id 是员工 id，avatar 在顶层
      expect(employees.result.current.data).toEqual([
        {
          id: 'emp-1',
          name: '定价专家',
          avatar: 'https://api.dicebear.com/7.x/bottts/svg?seed=emp-1',
          industry: '通用',
          position: '专家',
        },
        {
          id: 'emp-2',
          name: '选品专家',
          avatar: 'https://api.dicebear.com/7.x/bottts/svg?seed=emp-2',
          industry: '通用',
          position: '专家',
        },
      ]);

      // 原始订阅形状不受影响：id 是订阅 id，employee 还在嵌套里
      expect(subs.result.current.data).toEqual(raw);
    });

    it('先挂 useSubscriptions 再挂 useSubscribedEmployees，头像不丢', async () => {
      mockGet.mockResolvedValue([subscription('emp-1', '定价专家')]);

      const client = freshClient();
      const w = wrapper(client);

      // 顺序颠倒也不能污染：这是原 bug 的触发条件
      const subs = renderHook(() => useSubscriptions(), { wrapper: w });
      await waitFor(() => expect(subs.result.current.isSuccess).toBe(true));

      const employees = renderHook(() => useSubscribedEmployees(), { wrapper: w });
      await waitFor(() => expect(employees.result.current.isSuccess).toBe(true));

      expect(employees.result.current.data?.[0].avatar).toBe(
        'https://api.dicebear.com/7.x/bottts/svg?seed=emp-1',
      );
      expect(employees.result.current.data?.[0].id).toBe('emp-1');
    });

    it('两个 hook 各自独立请求，缓存不串（互不复用对方的 fetch 结果）', async () => {
      mockGet.mockResolvedValue([subscription('emp-1', '定价专家')]);

      const client = freshClient();
      const w = wrapper(client);

      renderHook(() => useSubscribedEmployees(), { wrapper: w });
      renderHook(() => useSubscriptions(), { wrapper: w });

      await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
      expect(mockGet).toHaveBeenNthCalledWith(1, '/subscriptions');
      expect(mockGet).toHaveBeenNthCalledWith(2, '/subscriptions');
    });

    it('订阅变更后 invalidateQueries(subscriptions) 前缀匹配能连带刷新员工列表', async () => {
      mockGet.mockResolvedValue([subscription('emp-1', '定价专家')]);

      const client = freshClient();
      const w = wrapper(client);

      const employees = renderHook(() => useSubscribedEmployees(), { wrapper: w });
      await waitFor(() => expect(employees.result.current.isSuccess).toBe(true));

      const callsBefore = mockGet.mock.calls.length;

      // subscribedEmployees 是 ['subscriptions','as-employees']，
      // 所以订阅相关 mutation 里现有的 invalidate 仍然覆盖它 —— 拆 key 没拆掉失效链路
      await client.invalidateQueries({ queryKey: qk.subscriptions });

      await waitFor(() =>
        expect(mockGet.mock.calls.length).toBeGreaterThan(callsBefore),
      );
    });
  });

  describe('数据映射', () => {
    it('过滤掉没有 employee 的脏数据', async () => {
      mockGet.mockResolvedValue([
        subscription('emp-1', '定价专家'),
        { id: 'sub-broken', status: 'ACTIVE' },
        { id: 'sub-null', status: 'ACTIVE', employee: null },
      ]);

      const { result } = renderHook(() => useSubscribedEmployees(), {
        wrapper: wrapper(freshClient()),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toHaveLength(1);
      expect(result.current.data?.[0].id).toBe('emp-1');
    });

    it('avatar 缺失时补 null 而不是 undefined', async () => {
      mockGet.mockResolvedValue([
        {
          id: 'sub-1',
          employee: { id: 'emp-1', name: '无头像', industry: '通用', position: '专家' },
        },
      ]);

      const { result } = renderHook(() => useSubscribedEmployees(), {
        wrapper: wrapper(freshClient()),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.[0].avatar).toBeNull();
    });

    it('接口返回非数组时给空数组而不是崩', async () => {
      mockGet.mockResolvedValue({ message: 'unexpected' } as never);

      const { result } = renderHook(() => useSubscribedEmployees(), {
        wrapper: wrapper(freshClient()),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual([]);
    });

    it('空订阅列表返回空数组', async () => {
      mockGet.mockResolvedValue([]);

      const { result } = renderHook(() => useSubscribedEmployees(), {
        wrapper: wrapper(freshClient()),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual([]);
    });
  });
});
