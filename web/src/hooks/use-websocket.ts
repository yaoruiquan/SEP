import { useEffect, useRef, useCallback, useState } from 'react';
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
}

export function useWebSocket(url: string, options: UseWebSocketOptions = {}) {
  const {
    onMessage,
    onConnect,
    onDisconnect,
    onError,
    reconnectInterval = 3000,
    heartbeatInterval = 30000,
    maxReconnectAttempts = 10,
  } = options;

  const { token } = useAuthStore();
  const [isConnected, setIsConnected] = useState(false);
  const [reconnectCount, setReconnectCount] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null);
  const heartbeatTimerRef = useRef<NodeJS.Timeout | null>(null);
  const shouldReconnectRef = useRef(true);

  const clearTimers = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
  }, []);

  const sendHeartbeat = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
    }
  }, []);

  const startHeartbeat = useCallback(() => {
    clearTimers();
    heartbeatTimerRef.current = setInterval(sendHeartbeat, heartbeatInterval);
  }, [sendHeartbeat, heartbeatInterval, clearTimers]);

  const connect = useCallback(() => {
    // URL 为空或未登录不连接
    if (!url || !token) {
      return;
    }

    // 已有连接则先关闭
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    try {
      // WebSocket URL 添加 token 作为查询参数
      const wsUrl = `${url}?token=${encodeURIComponent(token)}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[WebSocket] Connected');
        setIsConnected(true);
        setReconnectCount(0);
        startHeartbeat();
        onConnect?.();
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as WebSocketMessage;

          // 忽略 pong 消息
          if (message.type === 'pong') {
            return;
          }

          onMessage?.(message);
        } catch (error) {
          console.error('[WebSocket] Failed to parse message:', error);
        }
      };

      ws.onerror = (error) => {
        // 连接失败是暂时状态（后端未就绪），用 warn 而非 error 避免误报
        console.warn('[WebSocket] Connection error (will retry):', url);
        onError?.(error);
      };

      ws.onclose = () => {
        console.log('[WebSocket] Disconnected');
        setIsConnected(false);
        clearTimers();
        onDisconnect?.();

        // 自动重连（指数退避，最多 maxReconnectAttempts 次）
        if (shouldReconnectRef.current && reconnectCount < maxReconnectAttempts) {
          const attempt = reconnectCount + 1;
          const delay = Math.min(reconnectInterval * Math.pow(1.5, reconnectCount), 30000);
          console.log(`[WebSocket] Reconnecting in ${Math.round(delay)}ms... (${attempt}/${maxReconnectAttempts})`);
          reconnectTimerRef.current = setTimeout(() => {
            setReconnectCount((prev) => prev + 1);
            connect();
          }, delay);
        } else if (!shouldReconnectRef.current) {
          // 主动断开，不输出任何内容
        } else {
          console.warn(`[WebSocket] Gave up reconnecting to ${url} after ${maxReconnectAttempts} attempts`);
        }
      };
    } catch (error) {
      console.error('[WebSocket] Connection error:', error);
    }
  }, [
    url,
    token,
    reconnectInterval,
    maxReconnectAttempts,
    reconnectCount,
    onConnect,
    onDisconnect,
    onError,
    onMessage,
    startHeartbeat,
    clearTimers,
  ]);

  const disconnect = useCallback(() => {
    shouldReconnectRef.current = false;
    clearTimers();
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
  }, [clearTimers]);

  const send = useCallback((message: WebSocketMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    } else {
      console.warn('[WebSocket] Cannot send message: not connected');
    }
  }, []);

  // 连接和清理
  useEffect(() => {
    shouldReconnectRef.current = true;
    connect();

    return () => {
      shouldReconnectRef.current = false;
      disconnect();
    };
  }, [connect, disconnect]);

  return {
    isConnected,
    reconnectCount,
    send,
    disconnect,
    reconnect: connect,
  };
}
