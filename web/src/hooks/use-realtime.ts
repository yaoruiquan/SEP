import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useWebSocket, WebSocketMessage } from './use-websocket';

const WS_BASE_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001';

interface TaskUpdateMessage {
  taskId: string;
  status: 'running' | 'completed' | 'failed';
  progress?: number;
  result?: any;
  error?: string;
}

interface NotificationMessage {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message: string;
  timestamp: number;
}

/**
 * 任务实时更新 hook
 * 监听任务状态变化并自动更新查询缓存
 */
export function useTaskUpdates() {
  const queryClient = useQueryClient();

  const handleMessage = (message: WebSocketMessage) => {
    switch (message.type) {
      case 'task:update':
        const taskUpdate = message.data as TaskUpdateMessage;
        console.log('[TaskUpdates] Task update:', taskUpdate);

        // 使任务列表查询失效，触发重新获取
        queryClient.invalidateQueries({ queryKey: ['tasks'] });

        // 如果有特定任务 ID，也更新单个任务查询
        if (taskUpdate.taskId) {
          queryClient.invalidateQueries({ queryKey: ['tasks', taskUpdate.taskId] });
        }
        break;

      case 'task:completed':
        console.log('[TaskUpdates] Task completed:', message.data);
        queryClient.invalidateQueries({ queryKey: ['tasks'] });
        break;

      case 'task:failed':
        console.log('[TaskUpdates] Task failed:', message.data);
        queryClient.invalidateQueries({ queryKey: ['tasks'] });
        break;

      default:
        break;
    }
  };

  const { isConnected, reconnectCount } = useWebSocket(
    `${WS_BASE_URL}/ws/tasks`,
    {
      onMessage: handleMessage,
      onConnect: () => console.log('[TaskUpdates] Connected to task updates'),
      onDisconnect: () => console.log('[TaskUpdates] Disconnected from task updates'),
    }
  );

  return { isConnected, reconnectCount };
}

/**
 * 通知实时推送 hook
 * 监听系统通知并触发 UI 更新
 */
export function useNotifications(onNotification?: (notification: NotificationMessage) => void) {
  const queryClient = useQueryClient();

  const handleMessage = (message: WebSocketMessage) => {
    if (message.type === 'notification') {
      const notification = message.data as NotificationMessage;
      console.log('[Notifications] New notification:', notification);

      // 触发回调
      onNotification?.(notification);

      // 使通知列表查询失效
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    }
  };

  const { isConnected, reconnectCount } = useWebSocket(
    `${WS_BASE_URL}/ws/notifications`,
    {
      onMessage: handleMessage,
      onConnect: () => console.log('[Notifications] Connected to notifications'),
      onDisconnect: () => console.log('[Notifications] Disconnected from notifications'),
    }
  );

  return { isConnected, reconnectCount };
}

/**
 * 在线状态实时更新 hook
 * 监听用户和员工的在线状态变化
 */
export function usePresence() {
  const queryClient = useQueryClient();

  const handleMessage = (message: WebSocketMessage) => {
    switch (message.type) {
      case 'presence:update':
        console.log('[Presence] Status update:', message.data);
        // 使相关查询失效
        queryClient.invalidateQueries({ queryKey: ['employees'] });
        queryClient.invalidateQueries({ queryKey: ['my-employees'] });
        break;

      default:
        break;
    }
  };

  const { isConnected, reconnectCount } = useWebSocket(
    `${WS_BASE_URL}/ws/presence`,
    {
      onMessage: handleMessage,
      onConnect: () => console.log('[Presence] Connected to presence updates'),
      onDisconnect: () => console.log('[Presence] Disconnected from presence updates'),
    }
  );

  return { isConnected, reconnectCount };
}
