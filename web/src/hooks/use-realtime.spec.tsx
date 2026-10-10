import type { ReactNode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWebSocket, type WebSocketMessage } from './use-websocket';
import { useNotifications } from './use-realtime';

vi.mock('./use-websocket', () => ({ useWebSocket: vi.fn() }));

let queryClient: QueryClient;

function Wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function deliver(type: string, data: unknown = {}) {
  const calls = vi.mocked(useWebSocket).mock.calls;
  const onMessage = calls[calls.length - 1][1]?.onMessage;
  expect(onMessage).toBeTypeOf('function');
  act(() => onMessage!({ type, data, timestamp: Date.now() } satisfies WebSocketMessage));
}

const listKeys = [
  ['notifications', 50, 0, undefined, undefined],
  ['notifications', 50, 50, 'SYSTEM', false],
  ['notifications', 20, 0, 'APPROVAL', true],
] as const;
const countKeys = [
  ['notifications', 'unread-count'],
  ['notifications', 'unread-count', undefined],
  ['notifications', 'unread-count', 'SYSTEM'],
  ['notifications', 'unread-count', 'USAGE_ALERT'],
  ['notifications', 'unread-count', 'SECURITY'],
  ['notifications', 'unread-count', 'APPROVAL'],
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useWebSocket).mockReturnValue({
    isConnected: false, reconnectCount: 0, send: vi.fn(), disconnect: vi.fn(), reconnect: vi.fn(),
  });
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  listKeys.forEach((key) => queryClient.setQueryData(key, { items: [{ id: 'cached' }], total: 1 }));
  countKeys.forEach((key, index) => queryClient.setQueryData(key, { count: index + 1 }));
  queryClient.setQueryData(['tasks'], [{ id: 'task' }]);
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.restoreAllMocks();
});

describe('useNotifications realtime cache recovery', () => {
  it('invalidates the entire notifications prefix on every connected event, including reconnection', () => {
    renderHook(() => useNotifications(), { wrapper: Wrapper });
    expect(useWebSocket).toHaveBeenCalledWith(
      expect.stringMatching(/\/ws\/notifications$/), expect.objectContaining({ onMessage: expect.any(Function) }),
    );
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const keys = [...listKeys, ...countKeys];

    for (let connection = 0; connection < 2; connection += 1) {
      keys.forEach((key) => {
        const data = queryClient.getQueryData(key);
        queryClient.setQueryData(key, data);
        expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false);
      });
      deliver('connected');
      expect(invalidate).toHaveBeenLastCalledWith({ queryKey: ['notifications'] });
      keys.forEach((key) => expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true));
      expect(queryClient.getQueryState(['tasks'])?.isInvalidated).toBe(false);
    }
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  it('invalidates notification lists and counts without writing the global count into category caches', () => {
    renderHook(() => useNotifications(), { wrapper: Wrapper });
    const cachedCounts = countKeys.map((key) => queryClient.getQueryData(key));
    const setData = vi.spyOn(queryClient, 'setQueryData');
    const setQueriesData = vi.spyOn(queryClient, 'setQueriesData');
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    deliver('unread_count', { count: 99 });

    expect(invalidate).toHaveBeenCalledExactlyOnceWith({ queryKey: ['notifications'] });
    expect(setData).not.toHaveBeenCalled();
    expect(setQueriesData).not.toHaveBeenCalled();
    countKeys.forEach((key, index) => {
      expect(queryClient.getQueryData(key)).toEqual(cachedCounts[index]);
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    });
    listKeys.forEach((key) => expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true));
    expect(queryClient.getQueryState(['tasks'])?.isInvalidated).toBe(false);
  });

  it('delivers notifications to the latest callback and invalidates lists and counts', () => {
    const original = vi.fn();
    const updated = vi.fn();
    const { rerender } = renderHook(({ callback }) => useNotifications(callback), {
      initialProps: { callback: original }, wrapper: Wrapper,
    });
    rerender({ callback: updated });
    const notification = { id: 'n1', type: 'INFO', title: 'Update', message: 'Ready', timestamp: Date.now() };
    deliver('notification', notification);
    expect(original).not.toHaveBeenCalled();
    expect(updated).toHaveBeenCalledExactlyOnceWith(notification);
    [...listKeys, ...countKeys].forEach((key) => expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true));
    expect(queryClient.getQueryState(['tasks'])?.isInvalidated).toBe(false);
  });

  it('ignores unrelated messages and preserves the websocket connection state', () => {
    vi.mocked(useWebSocket).mockReturnValue({
      isConnected: true, reconnectCount: 2, send: vi.fn(), disconnect: vi.fn(), reconnect: vi.fn(),
    });
    const onNotification = vi.fn();
    const { result } = renderHook(() => useNotifications(onNotification), { wrapper: Wrapper });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    deliver('unknown', { count: 99 });
    expect(invalidate).not.toHaveBeenCalled();
    expect(onNotification).not.toHaveBeenCalled();
    expect(result.current).toEqual({ isConnected: true, reconnectCount: 2 });
  });
});
