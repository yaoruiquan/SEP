'use client';

import { useState, useEffect, useCallback } from 'react';
import { Bell, Check, Trash2, X } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { Button } from '@/components/ui/button';
import { CenteredSpinner } from '@/components/ui/feedback';
import { cn } from '@/lib/utils';
import {
  useNotifications,
  useUnreadCount,
  useMarkAsRead,
  useMarkAllAsRead,
  useDeleteNotification,
  type Notification,
} from '@/features/notifications/use-notifications';
import { useNotifications as useNotificationsRealtime } from '@/hooks/use-realtime';
import { useQueryClient } from '@tanstack/react-query';

const TYPE_STYLES = {
  INFO: 'text-gtext-secondary',
  SUCCESS: 'text-success',
  WARNING: 'text-warning',
  ERROR: 'text-danger',
};

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const { data: unreadData } = useUnreadCount();
  const { data: notificationsData, isLoading } = useNotifications(20, 0);
  const markAsRead = useMarkAsRead();
  const markAllAsRead = useMarkAllAsRead();
  const deleteNotification = useDeleteNotification();
  const queryClient = useQueryClient();

  const unreadCount = unreadData?.count ?? 0;
  const notifications = notificationsData?.items ?? [];

  // WebSocket 实时更新
  useNotificationsRealtime((notification) => {
    // 新通知到达，刷新列表
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
  });

  const handleMarkAsRead = useCallback(
    (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      markAsRead.mutate(id);
    },
    [markAsRead],
  );

  const handleDelete = useCallback(
    (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      deleteNotification.mutate(id);
    },
    [deleteNotification],
  );

  const handleMarkAllAsRead = useCallback(() => {
    markAllAsRead.mutate();
  }, [markAllAsRead]);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-notification-bell]')) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  return (
    <div className="relative" data-notification-bell>
      <button
        onClick={() => setOpen(!open)}
        className="relative flex h-9 w-9 items-center justify-center rounded-glass-sm border border-glassline bg-glass-2 text-gtext-secondary transition-colors hover:bg-glass-3 hover:text-gtext-primary"
        aria-label="通知"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-gdanger px-1 text-xs font-bold text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-12 z-50 w-96 rounded-glass-lg border border-glassline bg-glass-1 shadow-glass-lg backdrop-blur-glass-lg">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-glassline px-4 py-3">
            <h3 className="text-sm font-semibold text-gtext-primary">通知</h3>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleMarkAllAsRead}
                  disabled={markAllAsRead.isPending}
                >
                  <Check className="h-4 w-4" />
                  全部已读
                </Button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="rounded hover:bg-glass-2 p-1"
              >
                <X className="h-4 w-4 text-gtext-muted" />
              </button>
            </div>
          </div>

          {/* List */}
          <div className="max-h-[480px] overflow-y-auto scroll-thin">
            {isLoading ? (
              <div className="py-8">
                <CenteredSpinner label="加载中..." />
              </div>
            ) : notifications.length === 0 ? (
              <div className="py-12 text-center text-sm text-gtext-muted">
                暂无通知
              </div>
            ) : (
              <div className="divide-y divide-glassline">
                {notifications.map((notif) => (
                  <NotificationItem
                    key={notif.id}
                    notification={notif}
                    onMarkAsRead={handleMarkAsRead}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface NotificationItemProps {
  notification: Notification;
  onMarkAsRead: (id: string, e: React.MouseEvent) => void;
  onDelete: (id: string, e: React.MouseEvent) => void;
}

function NotificationItem({ notification, onMarkAsRead, onDelete }: NotificationItemProps) {
  return (
    <div
      className={cn(
        'group relative px-4 py-3 transition-colors hover:bg-glass-2',
        !notification.read && 'bg-glass-2/50',
      )}
    >
      {/* 未读指示器 */}
      {!notification.read && (
        <div className="absolute left-2 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-primary" />
      )}

      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h4
              className={cn(
                'text-sm font-medium',
                TYPE_STYLES[notification.type],
              )}
            >
              {notification.title}
            </h4>
            <span className="shrink-0 text-xs text-gtext-muted">
              {formatDistanceToNow(new Date(notification.createdAt), {
                addSuffix: true,
                locale: zhCN,
              })}
            </span>
          </div>
          <p className="mt-1 text-sm text-gtext-secondary line-clamp-2">
            {notification.message}
          </p>
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="mt-2 flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
        {!notification.read && (
          <button
            onClick={(e) => onMarkAsRead(notification.id, e)}
            className="text-xs text-gtext-muted hover:text-gtext-primary"
          >
            <Check className="inline h-3 w-3" /> 标记已读
          </button>
        )}
        <button
          onClick={(e) => onDelete(notification.id, e)}
          className="text-xs text-gtext-muted hover:text-danger"
        >
          <Trash2 className="inline h-3 w-3" /> 删除
        </button>
      </div>
    </div>
  );
}
