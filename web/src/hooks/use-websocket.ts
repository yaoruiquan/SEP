import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/lib/auth-store';

export interface WebSocketMessage<T = any> {
  type: string;
  data: T;
  timestamp: number;
}

interface UseWebSocketOptions {
  onMessage?: (message: WebSocketMessage) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Event) => void;
  reconnectInterval?: number;
  heartbeatInterval?: number;
  maxReconnectAttempts?: number;
  authenticationTimeout?: number;
}

type Timer = ReturnType<typeof setTimeout>;

const DEFAULT_AUTHENTICATION_TIMEOUT = 10_000;

/**
 * 带首条消息认证、心跳和有界重连的 WebSocket。
 *
 * `WebSocket.onopen` 只表示握手完成，业务连接必须等服务端返回
 * `connected` 后才算成功。所有回调都带 connection generation，避免旧
 * 连接晚到的 onclose/onmessage 影响已经建立的新连接。
 */
export function useWebSocket(url: string, options: UseWebSocketOptions = {}) {
  const {
    onMessage,
    onConnect,
    onDisconnect,
    onError,
    reconnectInterval = 3000,
    heartbeatInterval = 30000,
    maxReconnectAttempts = 10,
    authenticationTimeout = DEFAULT_AUTHENTICATION_TIMEOUT,
  } = options;

  const token = useAuthStore((state) => state.token);
  const [isConnected, setIsConnected] = useState(false);
  const [reconnectCount, setReconnectCount] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const generationRef = useRef(0);
  const reconnectAttemptRef = useRef(0);
  const shouldReconnectRef = useRef(false);
  const reconnectTimerRef = useRef<Timer | null>(null);
  const authTimerRef = useRef<Timer | null>(null);
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPongAtRef = useRef(0);
  const authenticatedGenerationRef = useRef<number | null>(null);
  const openConnectionRef = useRef<(generation: number) => void>(() => undefined);

  const onMessageRef = useRef(onMessage);
  const onConnectRef = useRef(onConnect);
  const onDisconnectRef = useRef(onDisconnect);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onMessageRef.current = onMessage;
    onConnectRef.current = onConnect;
    onDisconnectRef.current = onDisconnect;
    onErrorRef.current = onError;
  }, [onMessage, onConnect, onDisconnect, onError]);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const clearConnectionTimers = useCallback(() => {
    if (authTimerRef.current) {
      clearTimeout(authTimerRef.current);
      authTimerRef.current = null;
    }
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
  }, []);

  const clearAllTimers = useCallback(() => {
    clearReconnectTimer();
    clearConnectionTimers();
  }, [clearConnectionTimers, clearReconnectTimer]);

  const scheduleReconnect = useCallback((generation: number) => {
    if (!shouldReconnectRef.current || generation !== generationRef.current) return;
    if (reconnectAttemptRef.current >= maxReconnectAttempts) {
      console.warn(`[WebSocket] Gave up reconnecting to ${url} after ${maxReconnectAttempts} attempts`);
      return;
    }

    const attempt = reconnectAttemptRef.current + 1;
    reconnectAttemptRef.current = attempt;
    setReconnectCount(attempt);
    const delay = Math.min(reconnectInterval * Math.pow(1.5, attempt - 1), 30_000);

    clearReconnectTimer();
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      if (!shouldReconnectRef.current || generation !== generationRef.current) return;
      openConnectionRef.current(generation);
    }, delay);
  }, [clearReconnectTimer, maxReconnectAttempts, reconnectInterval, url]);

  const openConnection = useCallback((generation: number) => {
    if (!url || !token || !shouldReconnectRef.current || generation !== generationRef.current) {
      return;
    }

    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch {
      scheduleReconnect(generation);
      return;
    }
    wsRef.current = socket;
    authenticatedGenerationRef.current = null;
    setIsConnected(false);
    authTimerRef.current = setTimeout(() => {
      if (generation !== generationRef.current || wsRef.current !== socket) return;
      socket.close(4008, 'Authentication timeout');
    }, authenticationTimeout);

    socket.onopen = () => {
      if (generation !== generationRef.current || wsRef.current !== socket) {
        socket.close();
        return;
      }

      socket.send(JSON.stringify({ type: 'auth', token }));
      if (authTimerRef.current) clearTimeout(authTimerRef.current);
      authTimerRef.current = setTimeout(() => {
        if (generation !== generationRef.current || wsRef.current !== socket) return;
        console.warn('[WebSocket] Authentication timed out');
        socket.close(4008, 'Authentication timeout');
      }, authenticationTimeout);
    };

    socket.onmessage = (event) => {
      if (generation !== generationRef.current || wsRef.current !== socket) return;

      let input: unknown;
      try {
        input = JSON.parse(event.data);
      } catch (error) {
        console.error('[WebSocket] Failed to parse message:', error);
        return;
      }
      if (!input || typeof input !== 'object' || Array.isArray(input) ||
        !('type' in input) || typeof input.type !== 'string') return;
      const message = input as WebSocketMessage;
      if (message.type !== 'connected' && authenticatedGenerationRef.current !== generation) return;

      if (message.type === 'pong') {
        lastPongAtRef.current = Date.now();
        return;
      }

      if (message.type === 'connected') {
        if (authTimerRef.current) {
          clearTimeout(authTimerRef.current);
          authTimerRef.current = null;
        }
        if (authenticatedGenerationRef.current !== generation) {
          authenticatedGenerationRef.current = generation;
          reconnectAttemptRef.current = 0;
          setReconnectCount(0);
          setIsConnected(true);
          lastPongAtRef.current = Date.now();
          heartbeatTimerRef.current = setInterval(() => {
            if (generation !== generationRef.current || wsRef.current !== socket) return;
            if (Date.now() - lastPongAtRef.current > heartbeatInterval * 2) {
              console.warn('[WebSocket] Heartbeat timed out');
              socket.close(4001, 'Heartbeat timeout');
              return;
            }
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
            }
          }, heartbeatInterval);
          onConnectRef.current?.();
        }
      }

      onMessageRef.current?.(message);
    };

    socket.onerror = (error) => {
      if (generation !== generationRef.current || wsRef.current !== socket) return;
      console.warn('[WebSocket] Connection error (will retry):', url);
      onErrorRef.current?.(error);
    };

    socket.onclose = () => {
      if (generation !== generationRef.current || wsRef.current !== socket) return;

      const wasAuthenticated = authenticatedGenerationRef.current === generation;
      wsRef.current = null;
      authenticatedGenerationRef.current = null;
      clearConnectionTimers();
      setIsConnected(false);
      if (wasAuthenticated) onDisconnectRef.current?.();
      scheduleReconnect(generation);
    };
  }, [authenticationTimeout, clearConnectionTimers, heartbeatInterval, scheduleReconnect, token, url]);

  useEffect(() => {
    openConnectionRef.current = openConnection;
  }, [openConnection]);

  const disconnect = useCallback(() => {
    shouldReconnectRef.current = false;
    generationRef.current += 1;
    clearAllTimers();
    const socket = wsRef.current;
    wsRef.current = null;
    authenticatedGenerationRef.current = null;
    setIsConnected(false);
    if (socket && socket.readyState !== WebSocket.CLOSED) socket.close(1000, 'Client disconnect');
  }, [clearAllTimers]);

  const reconnect = useCallback(() => {
    shouldReconnectRef.current = true;
    generationRef.current += 1;
    const generation = generationRef.current;
    reconnectAttemptRef.current = 0;
    setReconnectCount(0);
    clearAllTimers();
    const socket = wsRef.current;
    wsRef.current = null;
    authenticatedGenerationRef.current = null;
    setIsConnected(false);
    if (socket && socket.readyState !== WebSocket.CLOSED) socket.close(1000, 'Reconnect');
    openConnectionRef.current(generation);
  }, [clearAllTimers]);

  useEffect(() => {
    shouldReconnectRef.current = Boolean(url && token);
    generationRef.current += 1;
    const generation = generationRef.current;
    reconnectAttemptRef.current = 0;
    setReconnectCount(0);
    clearAllTimers();

    const previousSocket = wsRef.current;
    wsRef.current = null;
    authenticatedGenerationRef.current = null;
    setIsConnected(false);
    if (previousSocket && previousSocket.readyState !== WebSocket.CLOSED) {
      previousSocket.close(1000, 'Connection replaced');
    }

    if (shouldReconnectRef.current) openConnection(generation);

    return () => {
      shouldReconnectRef.current = false;
      generationRef.current += 1;
      clearAllTimers();
      const socket = wsRef.current;
      wsRef.current = null;
      authenticatedGenerationRef.current = null;
      if (socket && socket.readyState !== WebSocket.CLOSED) socket.close(1000, 'Component unmount');
    };
  }, [clearAllTimers, openConnection, token, url]);

  const send = useCallback((message: WebSocketMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    } else {
      console.warn('[WebSocket] Cannot send message: not connected');
    }
  }, []);

  return { isConnected, reconnectCount, send, disconnect, reconnect };
}
