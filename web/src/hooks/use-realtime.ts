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
  type: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';
  title: string;
  message: string;
  timestamp: number;
}

/**
 * 任务实时更新 hook
 */
export function useTaskUpdates() {
  const queryClient = useQueryClient();

  const handleMessage = (message: WebSocketMessage) => {
    switch (message.type) {
      case 'task:update': {
        const taskUpdate = message.data as TaskUpdateMessage;
        queryClient.invalidateQueries({ queryKey: ['tasks'] });
        if (taskUpdate.taskId) {
          queryClient.invalidateQueries({ queryKey: ['tasks', taskUpdate.taskId] });
        }
        break;
      }
      case 'task:completed':
      case 'task:failed':
        queryClient.invalidateQueries({ queryKey: ['tasks'] });
        break;
      default:
        break;
    }
  };

  // /ws/tasks gateway 尚未实现，传空 URL 禁止连接
  const { isConnected, reconnectCount } = useWebSocket('', {
    onMessage: handleMessage,
  });

  return { isConnected, reconnectCount };
}

/**
 * 通知实时推送 hook
 * 监听系统通知并触发 UI 更新
 */
export function useNotifications(onNotification?: (notification: NotificationMessage) => void) {
  const queryClient = useQueryClient();

  const handleMessage = (message: WebSocketMessage) => {
    switch (message.type) {
      case 'notification': {
        const notification = message.data as NotificationMessage;
        onNotification?.(notification);
        queryClient.invalidateQueries({ queryKey: ['notifications'] });
        break;
      }
      case 'connected':
        // 连接成功，刷新未读数
        queryClient.invalidateQueries({ queryKey: ['notifications', 'unread-count'] });
        break;
      case 'unread_count':
        // 后端主动推送未读数变化，直接更新缓存
        queryClient.setQueryData(['notifications', 'unread-count'], {
          count: (message.data as { count: number }).count,
        });
        break;
      default:
        break;
    }
  };

  const { isConnected, reconnectCount } = useWebSocket(`${WS_BASE_URL}/ws/notifications`, {
    onMessage: handleMessage,
    onConnect: () => queryClient.invalidateQueries({ queryKey: ['notifications', 'unread-count'] }),
  });

  return { isConnected, reconnectCount };
}

/**
 * 在线状态实时更新 hook
 */
export function usePresence() {
  const queryClient = useQueryClient();

  const handleMessage = (message: WebSocketMessage) => {
    if (message.type === 'presence:update') {
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      queryClient.invalidateQueries({ queryKey: ['my-employees'] });
    }
  };

  // /ws/presence gateway 尚未实现，传空 URL 禁止连接
  const { isConnected, reconnectCount } = useWebSocket('', {
    onMessage: handleMessage,
  });

  return { isConnected, reconnectCount };
}
