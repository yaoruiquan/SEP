import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

export type NotificationCategory = 'SYSTEM' | 'USAGE_ALERT' | 'SECURITY' | 'APPROVAL';
export type NotificationSeverity = 'INFO' | 'WARNING' | 'ERROR';

export interface Notification {
  id: string;
  type: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';
  title: string;
  message: string;
  relatedType?: string;
  relatedId?: string;
  read: boolean;
  category?: NotificationCategory;
  severity?: NotificationSeverity;
  actionUrl?: string;
  createdAt: string;
}

export interface NotificationsResponse {
  items: Notification[];
  total: number;
}

export interface NotificationPreference {
  systemEnabled: boolean;
  usageAlertEnabled: boolean;
  securityEnabled: boolean;
  approvalEnabled: boolean;
  emailEnabled: boolean;
}

/**
 * 获取通知列表（支持分类和未读过滤）
 */
export function useNotifications(
  limit = 50,
  offset = 0,
  category?: NotificationCategory,
  unreadOnly?: boolean,
) {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (category) params.set('category', category);
  if (unreadOnly) params.set('unreadOnly', 'true');

  return useQuery<NotificationsResponse>({
    queryKey: ['notifications', limit, offset, category, unreadOnly],
    queryFn: () => api.get<NotificationsResponse>(`/notifications?${params}`),
    staleTime: 10_000,
  });
}

/**
 * 获取未读通知数量（支持分类过滤）
 */
export function useUnreadCount(category?: NotificationCategory) {
  const params = category ? `?category=${category}` : '';
  return useQuery<{ count: number }>({
    queryKey: ['notifications', 'unread-count', category],
    queryFn: () => api.get<{ count: number }>(`/notifications/unread-count${params}`),
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
 * 标记所有通知为已读（支持分类过滤）
 */
export function useMarkAllAsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (category?: NotificationCategory) => {
      const params = category ? `?category=${category}` : '';
      return api.post(`/notifications/read-all${params}`);
    },
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
 * 清空已读通知（支持分类过滤）
 */
export function useClearRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (category?: NotificationCategory) => {
      const params = category ? `?category=${category}` : '';
      return api.delete(`/notifications/clear-read${params}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

/**
 * 获取通知偏好设置
 */
export function useNotificationPreferences() {
  return useQuery<NotificationPreference>({
    queryKey: ['notifications', 'preferences'],
    queryFn: () => api.get<NotificationPreference>('/notifications/preferences'),
    staleTime: 60_000,
  });
}

/**
 * 更新通知偏好设置
 */
export function useUpdateNotificationPreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: Partial<NotificationPreference>) =>
      api.put<NotificationPreference>('/notifications/preferences', dto),
    onSuccess: (data) => {
      queryClient.setQueryData(['notifications', 'preferences'], data);
    },
  });
}
