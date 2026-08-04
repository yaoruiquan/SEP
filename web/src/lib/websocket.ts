import { useEffect, useRef, useState } from 'react';

type ConnectionStatus = 'connecting' | 'online' | 'offline';

interface UseWebSocketOptions {
  url: string;
  onMessage?: (data: any) => void;
  onError?: (error: Event) => void;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

/**
 * WebSocket Hook
 *
 * 提供自动重连的 WebSocket 连接管理
 *
 * @example
 * ```tsx
 * const { status, sendMessage } = useWebSocket({
 *   url: 'ws://localhost:3001/ws',
 *   onMessage: (data) => console.log('收到消息:', data),
 * });
 * ```
 */
export function useWebSocket({
  url,
  onMessage,
  onError,
  reconnectInterval = 3000,
  maxReconnectAttempts = 5,
}: UseWebSocketOptions) {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const connect = () => {
    try {
      const ws = new WebSocket(url);

      ws.onopen = () => {
        console.log('[WebSocket] Connected');
        setStatus('online');
        reconnectAttemptsRef.current = 0;
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          onMessage?.(data);
        } catch (error) {
          console.error('[WebSocket] Failed to parse message:', error);
        }
      };

      ws.onerror = (error) => {
        console.error('[WebSocket] Error:', error);
        onError?.(error);
      };

      ws.onclose = () => {
        console.log('[WebSocket] Disconnected');
        setStatus('offline');

        // 自动重连
        if (reconnectAttemptsRef.current < maxReconnectAttempts) {
          reconnectAttemptsRef.current += 1;
          console.log(
            `[WebSocket] Reconnecting (${reconnectAttemptsRef.current}/${maxReconnectAttempts})...`
          );

          reconnectTimeoutRef.current = setTimeout(() => {
            setStatus('connecting');
            connect();
          }, reconnectInterval);
        } else {
          console.error('[WebSocket] Max reconnect attempts reached');
        }
      };

      wsRef.current = ws;
    } catch (error) {
      console.error('[WebSocket] Failed to connect:', error);
      setStatus('offline');
    }
  };

  const sendMessage = (data: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    } else {
      console.warn('[WebSocket] Cannot send message: connection not open');
    }
  };

  const disconnect = () => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  };

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [url]);

  return {
    status,
    sendMessage,
    disconnect,
  };
}

/**
 * 实时员工状态 Hook
 *
 * 监听员工的在线/离线状态变化
 *
 * @example
 * ```tsx
 * const employeeStatuses = useEmployeeStatus();
 * const status = employeeStatuses[employeeId] || 'offline';
 * ```
 */
export function useEmployeeStatus() {
  const [statuses, setStatuses] = useState<Record<string, 'online' | 'offline' | 'busy'>>({});

  useWebSocket({
    url: `${process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001'}/employee-status`,
    onMessage: (data) => {
      if (data.type === 'status_update') {
        setStatuses((prev) => ({
          ...prev,
          [data.employeeId]: data.status,
        }));
      }
    },
  });

  return statuses;
}

/**
 * 全局 WebSocket 连接状态 Hook
 *
 * 用于显示全局连接状态指示器（如侧边栏右上角）
 */
export function useGlobalWebSocket() {
  return useWebSocket({
    url: `${process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001'}/global`,
    onMessage: (data) => {
      console.log('[Global WebSocket]', data);
    },
  });
}
