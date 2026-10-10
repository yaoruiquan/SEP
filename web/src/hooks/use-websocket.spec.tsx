import { StrictMode, type ReactNode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/lib/auth-store';
import { useWebSocket, type WebSocketMessage } from './use-websocket';

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: (() => void) | null = null;
  send = vi.fn<(data: string) => void>();
  close = vi.fn((_code?: number, _reason?: string) => {
    if (this.readyState === MockWebSocket.CLOSED) return;
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  });

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  message(type: string, data: unknown = {}) {
    this.onmessage?.(messageEvent(type, data));
  }
}

function messageEvent(type: string, data: unknown = {}) {
  return new MessageEvent<string>('message', {
    data: JSON.stringify({ type, data, timestamp: Date.now() }),
  });
}

const URL = 'ws://localhost/ws/notifications';

function latestSocket() {
  return MockWebSocket.instances[MockWebSocket.instances.length - 1];
}

function authenticate(socket = latestSocket()) {
  act(() => {
    socket.open();
    socket.message('connected');
  });
}

function advance(ms: number) {
  act(() => vi.advanceTimersByTime(ms));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-10T00:00:00Z'));
  vi.stubGlobal('WebSocket', MockWebSocket);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  MockWebSocket.instances = [];
  useAuthStore.setState({ token: 'test-token' });
});

afterEach(() => {
  cleanup();
  useAuthStore.getState().clear();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useWebSocket connection lifecycle', () => {
  it('creates one socket and remains offline until the server confirms authentication', () => {
    const onConnect = vi.fn();
    const onMessage = vi.fn();
    const { result, rerender } = renderHook(() => useWebSocket(URL, { onConnect, onMessage }));
    const socket = latestSocket();

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(socket.url).toBe(URL);
    expect(result.current.isConnected).toBe(false);
    act(() => socket.open());
    expect(socket.send).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ type: 'auth', token: 'test-token' }));
    expect(result.current.isConnected).toBe(false);
    expect(onConnect).not.toHaveBeenCalled();
    advance(1000);
    expect(socket.send).toHaveBeenCalledTimes(1);

    act(() => socket.message('connected'));
    expect(result.current.isConnected).toBe(true);
    expect(onConnect).toHaveBeenCalledTimes(1);
    act(() => socket.message('connected'));
    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledTimes(2);
    rerender();
    expect(MockWebSocket.instances).toHaveLength(1);

    advance(10_000);
    expect(socket.close).not.toHaveBeenCalled();
    expect(result.current.isConnected).toBe(true);
  });

  it('keeps only one live socket under StrictMode and clears it and all timers on unmount', () => {
    function Wrapper({ children }: { children: ReactNode }) {
      return <StrictMode>{children}</StrictMode>;
    }
    const { unmount } = renderHook(() => useWebSocket(URL), { wrapper: Wrapper });
    expect(MockWebSocket.instances.filter((socket) => socket.readyState !== MockWebSocket.CLOSED)).toHaveLength(1);
    authenticate();
    unmount();
    expect(MockWebSocket.instances.every((socket) => socket.readyState === MockWebSocket.CLOSED)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    const count = MockWebSocket.instances.length;
    advance(60_000);
    expect(MockWebSocket.instances).toHaveLength(count);
  });

  it.each(['missing token', 'empty URL'])('does not connect with %s', (condition) => {
    if (condition === 'missing token') useAuthStore.setState({ token: null });
    const { result } = renderHook(() => useWebSocket(condition === 'empty URL' ? '' : URL));
    expect(MockWebSocket.instances).toHaveLength(0);
    expect(result.current.isConnected).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('recovers from a throwing WebSocket constructor through the scheduled retry', () => {
    const construct = vi.fn();
    class FlakyWebSocket extends MockWebSocket {
      constructor(url: string) {
        construct();
        if (construct.mock.calls.length === 1) throw new Error('WebSocket construction failed');
        super(url);
      }
    }
    vi.stubGlobal('WebSocket', FlakyWebSocket);
    const { result } = renderHook(() => useWebSocket(URL, { reconnectInterval: 100 }));

    expect(construct).toHaveBeenCalledTimes(1);
    expect(MockWebSocket.instances).toHaveLength(0);
    expect(result.current.isConnected).toBe(false);
    expect(result.current.reconnectCount).toBe(1);
    advance(99);
    expect(construct).toHaveBeenCalledTimes(1);
    advance(1);
    expect(construct).toHaveBeenCalledTimes(2);
    expect(MockWebSocket.instances).toHaveLength(1);
    authenticate();
    expect(result.current.isConnected).toBe(true);
    expect(result.current.reconnectCount).toBe(0);
  });

  it.each([
    { label: 'null', payload: null },
    { label: 'array', payload: [{ type: 'notification', data: { id: 'invalid' }, timestamp: 0 }] },
  ])('ignores server JSON $label without throwing or forwarding it', ({ payload }) => {
    const onMessage = vi.fn();
    const { result } = renderHook(() => useWebSocket(URL, { onMessage }));
    const socket = latestSocket();
    authenticate(socket);
    onMessage.mockClear();

    expect(() => act(() => socket.onmessage?.(new MessageEvent<string>('message', {
      data: JSON.stringify(payload),
    })))).not.toThrow();
    expect(onMessage).not.toHaveBeenCalled();
    expect(result.current.isConnected).toBe(true);
    expect(socket.close).not.toHaveBeenCalled();
    act(() => socket.message('notification', { id: 'valid' }));
    expect(onMessage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      type: 'notification', data: { id: 'valid' },
    }));
  });

  it.each(['notification', 'unread_count'])('does not forward %s before connected but forwards it afterwards', (type) => {
    const onMessage = vi.fn();
    const onConnect = vi.fn();
    const { result } = renderHook(() => useWebSocket(URL, { onMessage, onConnect }));
    const socket = latestSocket();
    const data = type === 'notification' ? { id: 'n1' } : { count: 99 };
    act(() => {
      socket.open();
      socket.message(type, data);
    });

    expect(onMessage).not.toHaveBeenCalled();
    expect(onConnect).not.toHaveBeenCalled();
    expect(result.current.isConnected).toBe(false);
    act(() => socket.message('connected'));
    expect(result.current.isConnected).toBe(true);
    expect(onConnect).toHaveBeenCalledTimes(1);
    onMessage.mockClear();
    act(() => socket.message(type, data));
    expect(onMessage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type, data }));
  });

  it('uses the latest callbacks after rerender without replacing the socket', () => {
    const original = { onMessage: vi.fn(), onConnect: vi.fn(), onDisconnect: vi.fn(), onError: vi.fn() };
    const updated = { onMessage: vi.fn(), onConnect: vi.fn(), onDisconnect: vi.fn(), onError: vi.fn() };
    const { rerender } = renderHook((callbacks) => useWebSocket(URL, callbacks), { initialProps: original });
    const socket = latestSocket();
    act(() => socket.open());
    rerender(updated);
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(socket.close).not.toHaveBeenCalled();
    const error = new Event('error');
    act(() => {
      socket.message('connected');
      socket.message('notification', { id: 'n1' });
      socket.onerror?.(error);
      socket.close();
    });

    for (const callback of Object.values(original)) expect(callback).not.toHaveBeenCalled();
    expect(updated.onConnect).toHaveBeenCalledTimes(1);
    expect(updated.onMessage).toHaveBeenCalledTimes(2);
    expect(updated.onMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'notification', data: { id: 'n1' } }));
    expect(updated.onError).toHaveBeenCalledExactlyOnceWith(error);
    expect(updated.onDisconnect).toHaveBeenCalledTimes(1);
  });

  it.each(['manual reconnect', 'token change', 'URL change', 'automatic retry'])('ignores stale callbacks after %s', (replacement) => {
    const callbacks = { onMessage: vi.fn(), onConnect: vi.fn(), onDisconnect: vi.fn(), onError: vi.fn() };
    const { result, rerender } = renderHook(({ url }) => useWebSocket(url, {
      ...callbacks, reconnectInterval: 100, heartbeatInterval: 1000,
    }), { initialProps: { url: URL } });
    const old = latestSocket();
    authenticate(old);
    // Retain callbacks to simulate events already queued before the old socket closed.
    const stale = { open: old.onopen!, message: old.onmessage!, error: old.onerror!, close: old.onclose! };

    if (replacement === 'manual reconnect') act(() => result.current.reconnect());
    if (replacement === 'token change') act(() => useAuthStore.setState({ token: 'replacement-token' }));
    if (replacement === 'URL change') rerender({ url: `${URL}/new` });
    if (replacement === 'automatic retry') {
      act(() => old.close());
      advance(100);
    }
    expect(MockWebSocket.instances).toHaveLength(2);
    const current = latestSocket();
    expect(current).not.toBe(old);
    authenticate(current);
    expect(current.send).toHaveBeenCalledWith(JSON.stringify({
      type: 'auth', token: replacement === 'token change' ? 'replacement-token' : 'test-token',
    }));
    Object.values(callbacks).forEach((callback) => callback.mockClear());

    act(() => {
      stale.open();
      stale.message(messageEvent('connected'));
      stale.message(messageEvent('notification', { id: 'stale' }));
      stale.message(messageEvent('pong'));
      stale.error(new Event('error'));
      stale.close();
    });
    expect(result.current.isConnected).toBe(true);
    expect(result.current.reconnectCount).toBe(0);
    for (const callback of Object.values(callbacks)) expect(callback).not.toHaveBeenCalled();
    expect(current.close).not.toHaveBeenCalled();
    advance(1000);
    expect(MockWebSocket.instances).toHaveLength(2);
    expect(current.send).toHaveBeenLastCalledWith(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
    const message: WebSocketMessage = { type: 'client:event', data: { ok: true }, timestamp: Date.now() };
    act(() => result.current.send(message));
    expect(current.send).toHaveBeenLastCalledWith(JSON.stringify(message));
  });

  it.each(['connected', 'pending retry'])('does not reconnect after disconnect while %s, even after rerender', (state) => {
    const { result, rerender } = renderHook(() => useWebSocket(URL, {
      onMessage: () => undefined, reconnectInterval: 100,
    }));
    authenticate();
    const socket = latestSocket();
    if (state === 'pending retry') act(() => socket.close());
    act(() => result.current.disconnect());
    expect(result.current.isConnected).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    if (state === 'connected') expect(socket.close).toHaveBeenCalledWith(1000, 'Client disconnect');
    rerender();
    act(() => socket.onclose?.());
    advance(60_000);
    expect(MockWebSocket.instances).toHaveLength(1);
  });
});

describe('useWebSocket timeouts and retry limits', () => {
  it('times out and retries a handshake that never emits open', () => {
    const onConnect = vi.fn();
    const onDisconnect = vi.fn();
    const { result } = renderHook(() => useWebSocket(URL, {
      authenticationTimeout: 500, reconnectInterval: 100, onConnect, onDisconnect,
    }));
    const socket = latestSocket();
    expect(socket.readyState).toBe(MockWebSocket.CONNECTING);
    advance(499);
    expect(socket.close).not.toHaveBeenCalled();
    advance(1);
    expect(socket.close).toHaveBeenCalledTimes(1);
    expect(socket.send).not.toHaveBeenCalled();
    expect(result.current.isConnected).toBe(false);
    expect(result.current.reconnectCount).toBe(1);
    expect(onConnect).not.toHaveBeenCalled();
    expect(onDisconnect).not.toHaveBeenCalled();
    advance(99);
    expect(MockWebSocket.instances).toHaveLength(1);
    advance(1);
    expect(MockWebSocket.instances).toHaveLength(2);
    authenticate();
    expect(result.current.isConnected).toBe(true);
    expect(result.current.reconnectCount).toBe(0);
  });

  it('closes an unconfirmed authentication at the deadline and retries only after the delay', () => {
    const onConnect = vi.fn();
    const onDisconnect = vi.fn();
    const { result } = renderHook(() => useWebSocket(URL, {
      authenticationTimeout: 500, reconnectInterval: 100, onConnect, onDisconnect,
    }));
    const socket = latestSocket();
    act(() => socket.open());
    advance(499);
    expect(socket.close).not.toHaveBeenCalled();
    advance(1);
    expect(socket.close).toHaveBeenCalledExactlyOnceWith(4008, 'Authentication timeout');
    expect(result.current.isConnected).toBe(false);
    expect(result.current.reconnectCount).toBe(1);
    expect(onConnect).not.toHaveBeenCalled();
    expect(onDisconnect).not.toHaveBeenCalled();
    advance(99);
    expect(MockWebSocket.instances).toHaveLength(1);
    advance(1);
    expect(MockWebSocket.instances).toHaveLength(2);
    authenticate();
    expect(result.current.reconnectCount).toBe(0);
    expect(result.current.isConnected).toBe(true);
  });

  it('starts heartbeat only after authentication, consumes pong, and retries a missing-pong timeout', () => {
    const onMessage = vi.fn();
    const onDisconnect = vi.fn();
    const { result } = renderHook(() => useWebSocket(URL, {
      heartbeatInterval: 1000, reconnectInterval: 100, onMessage, onDisconnect,
    }));
    const socket = latestSocket();
    act(() => socket.open());
    advance(1000);
    expect(socket.send).toHaveBeenCalledTimes(1);
    act(() => socket.message('connected'));
    onMessage.mockClear();
    advance(2000);
    expect(socket.close).not.toHaveBeenCalled();
    expect(socket.send).toHaveBeenCalledTimes(3);
    act(() => socket.message('pong'));
    expect(onMessage).not.toHaveBeenCalled();
    advance(2000);
    expect(socket.close).not.toHaveBeenCalled();
    advance(1000);
    expect(socket.close).toHaveBeenCalledExactlyOnceWith(4001, 'Heartbeat timeout');
    expect(result.current.isConnected).toBe(false);
    expect(onDisconnect).toHaveBeenCalledTimes(1);
    expect(result.current.reconnectCount).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
    advance(100);
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it('bounds retries across authentication failures and applies increasing delays', () => {
    const { result } = renderHook(() => useWebSocket(URL, {
      authenticationTimeout: 50, reconnectInterval: 100, maxReconnectAttempts: 2,
    }));
    act(() => latestSocket().open());
    advance(50);
    expect(result.current.reconnectCount).toBe(1);
    advance(99);
    expect(MockWebSocket.instances).toHaveLength(1);
    advance(1);
    expect(MockWebSocket.instances).toHaveLength(2);
    act(() => latestSocket().open());
    advance(50);
    expect(result.current.reconnectCount).toBe(2);
    advance(149);
    expect(MockWebSocket.instances).toHaveLength(2);
    advance(1);
    expect(MockWebSocket.instances).toHaveLength(3);
    act(() => latestSocket().open());
    advance(50);
    expect(result.current.reconnectCount).toBe(2);
    expect(result.current.isConnected).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    advance(60_000);
    expect(MockWebSocket.instances).toHaveLength(3);
  });

  it('does not schedule retries when the retry limit is zero', () => {
    const { result } = renderHook(() => useWebSocket(URL, { maxReconnectAttempts: 0 }));
    act(() => latestSocket().close());
    advance(60_000);
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(result.current.reconnectCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
