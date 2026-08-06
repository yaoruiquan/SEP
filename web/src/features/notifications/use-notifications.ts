import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

export interface Notification {
  id: string;
  type: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';
  title: string;
  message: string;
  relatedType?: string;
  relatedId?: string;
  read: boolean;
  createdAt: string;
}

export interface NotificationsResponse {
  items: Notification[];
  total: number;
}

/**
 * 获取通知列表
 */
export function useNotifications(limit = 50, offset = 0) {
  return useQuery<NotificationsResponse>({
    queryKey: ['notifications', limit, offset],
    queryFn: () => api.get<NotificationsResponse>(`/notifications?limit=${limit}&offset=${offset}`),
    staleTime: 10_000,
  });
}

/**
 * 获取未读通知数量
 */
export function useUnreadCount() {
  return useQuery<{ count: number }>({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => api.get<{ count: number }>('/notifications/unread-count'),
    staleTime: 5_000,
    refetchInterval: 30_000, // 轮询 30s
  });
}

/**
 * 标记单条通知为已读
 */
export function useMarkAsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

/**
 * 标记所有通知为已读
 */
export function useMarkAllAsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.post('/notifications/read-all'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

/**
 * 删除通知
 */
export function useDeleteNotification() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.delete(`/notifications/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

/**
 * 清空所有已读通知
 */
export function useClearRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.delete('/notifications/clear-read'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}
