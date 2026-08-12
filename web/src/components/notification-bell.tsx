'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Bell,
  Check,
  Trash2,
  X,
  Settings2,
  BarChart2,
  ShieldAlert,
  CheckSquare,
  ExternalLink,
} from 'lucide-react';
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
  type NotificationCategory,
} from '@/features/notifications/use-notifications';
import { useNotifications as useNotificationsRealtime } from '@/hooks/use-realtime';
import { useQueryClient } from '@tanstack/react-query';
import { useActiveAnnouncements } from '@/features/announcement/use-announcements';

const SEVERITY_STYLES = {
  INFO: 'text-gtext-secondary',
  WARNING: 'text-warning',
  ERROR: 'text-danger',
};

const CATEGORY_TABS: Array<{
  key: NotificationCategory | 'ALL';
  label: string;
  icon: React.ReactNode;
}> = [
  { key: 'ALL', label: '全部', icon: <Bell className="h-3.5 w-3.5" /> },
  { key: 'SYSTEM', label: '系统', icon: <Settings2 className="h-3.5 w-3.5" /> },
  { key: 'USAGE_ALERT', label: '用量', icon: <BarChart2 className="h-3.5 w-3.5" /> },
  { key: 'SECURITY', label: '安全', icon: <ShieldAlert className="h-3.5 w-3.5" /> },
  { key: 'APPROVAL', label: '审批', icon: <CheckSquare className="h-3.5 w-3.5" /> },
];

const CATEGORY_BADGE: Record<NotificationCategory, { label: string; cls: string }> = {
  SYSTEM: { label: '系统', cls: 'bg-glass-3 text-gtext-muted' },
  USAGE_ALERT: { label: '用量', cls: 'bg-warning/10 text-warning' },
  SECURITY: { label: '安全', cls: 'bg-danger/10 text-danger' },
  APPROVAL: { label: '审批', cls: 'bg-primary/10 text-primary' },
};

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<NotificationCategory | 'ALL'>('ALL');
  const [dismissedAnnouncements, setDismissedAnnouncements] = useState<Set<string>>(new Set());

  const activeCategory = activeTab === 'ALL' ? undefined : activeTab;

  const { data: unreadData } = useUnreadCount();
  const { data: notificationsData, isLoading } = useNotifications(20, 0, activeCategory);
  const { data: announcements } = useActiveAnnouncements();
  const markAsRead = useMarkAsRead();
  const markAllAsRead = useMarkAllAsRead();
  const deleteNotification = useDeleteNotification();
  const queryClient = useQueryClient();

  const unreadCount = unreadData?.count ?? 0;
  const notifications = notificationsData?.items ?? [];

  // 过滤未关闭的公告
  const visibleAnnouncements = (announcements ?? []).filter(
    (a) => !dismissedAnnouncements.has(a.id)
  );

  // WebSocket 实时更新
  useNotificationsRealtime(() => {
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
    markAllAsRead.mutate(activeCategory);
  }, [markAllAsRead, activeCategory]);

  const handleDismissAnnouncement = useCallback((id: string) => {
    setDismissedAnnouncements((prev) => new Set([...prev, id]));
  }, []);

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
                className="rounded p-1 hover:bg-glass-2"
              >
                <X className="h-4 w-4 text-gtext-muted" />
              </button>
            </div>
          </div>

          {/* Announcements Section */}
          {visibleAnnouncements.length > 0 && (
            <div className="border-b border-glassline">
              <div className="max-h-[200px] space-y-2 overflow-y-auto scroll-thin p-3">
                {visibleAnnouncements.map((announcement) => (
                  <AnnouncementCard
                    key={announcement.id}
                    announcement={announcement}
                    onDismiss={handleDismissAnnouncement}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Category tabs */}
          <div className="flex gap-0.5 border-b border-glassline px-2 py-1.5">
            {CATEGORY_TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  'flex flex-1 items-center justify-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors',
                  activeTab === tab.key
                    ? 'bg-primary/10 text-primary'
                    : 'text-gtext-muted hover:bg-glass-2 hover:text-gtext-secondary',
                )}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          {/* List */}
          <div className="max-h-[400px] overflow-y-auto scroll-thin">
            {isLoading ? (
              <div className="py-8">
                <CenteredSpinner label="加载中..." />
              </div>
            ) : notifications.length === 0 ? (
              <div className="py-12 text-center text-sm text-gtext-muted">暂无通知</div>
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

          {/* Footer */}
          <div className="border-t border-glassline px-4 py-2">
            <Link
              href="/notifications"
              onClick={() => setOpen(false)}
              className="flex items-center justify-center gap-1.5 text-xs text-gtext-muted transition-colors hover:text-gtext-primary"
            >
              <ExternalLink className="h-3 w-3" />
              查看全部通知
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

const ANNOUNCEMENT_TYPE_STYLES = {
  INFO: { bg: 'bg-blue-500/10', border: 'border-blue-500/20', text: 'text-blue-700 dark:text-blue-300', icon: 'text-blue-600' },
  WARNING: { bg: 'bg-yellow-500/10', border: 'border-yellow-500/20', text: 'text-yellow-700 dark:text-yellow-300', icon: 'text-yellow-600' },
  ERROR: { bg: 'bg-red-500/10', border: 'border-red-500/20', text: 'text-red-700 dark:text-red-300', icon: 'text-red-600' },
  SUCCESS: { bg: 'bg-green-500/10', border: 'border-green-500/20', text: 'text-green-700 dark:text-green-300', icon: 'text-green-600' },
};

const ANNOUNCEMENT_TYPE_ICONS = {
  INFO: Bell,
  WARNING: ShieldAlert,
  ERROR: ShieldAlert,
  SUCCESS: CheckSquare,
};

interface AnnouncementCardProps {
  announcement: {
    id: string;
    title: string;
    content: string;
    type: 'INFO' | 'WARNING' | 'ERROR' | 'SUCCESS';
  };
  onDismiss: (id: string) => void;
}

function AnnouncementCard({ announcement, onDismiss }: AnnouncementCardProps) {
  const styles = ANNOUNCEMENT_TYPE_STYLES[announcement.type];
  const Icon = ANNOUNCEMENT_TYPE_ICONS[announcement.type];

  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-lg border p-3',
        styles.bg,
        styles.border,
        styles.text
      )}
    >
      <Icon className={cn('h-4 w-4 shrink-0 mt-0.5', styles.icon)} />
      <div className="min-w-0 flex-1">
        <h4 className="text-sm font-semibold">{announcement.title}</h4>
        <p className="mt-0.5 text-xs opacity-90 line-clamp-2">{announcement.content}</p>
      </div>
      <button
        onClick={() => onDismiss(announcement.id)}
        className="shrink-0 rounded p-0.5 hover:bg-black/10 dark:hover:bg-white/10"
        aria-label="关闭"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

interface NotificationItemProps {
  notification: Notification;
  onMarkAsRead: (id: string, e: React.MouseEvent) => void;
  onDelete: (id: string, e: React.MouseEvent) => void;
}

function NotificationItem({ notification, onMarkAsRead, onDelete }: NotificationItemProps) {
  const titleColor = notification.severity
    ? SEVERITY_STYLES[notification.severity]
    : 'text-gtext-primary';
  const badge = notification.category ? CATEGORY_BADGE[notification.category] : null;

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

      <div className="flex items-start gap-3 pl-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h4 className={cn('text-sm font-medium', titleColor)}>{notification.title}</h4>
            {badge && (
              <span className={cn('rounded px-1.5 py-0.5 text-xs', badge.cls)}>
                {badge.label}
              </span>
            )}
            <span className="ml-auto shrink-0 text-xs text-gtext-muted">
              {formatDistanceToNow(new Date(notification.createdAt), {
                addSuffix: true,
                locale: zhCN,
              })}
            </span>
          </div>
          <p className="mt-1 text-sm text-gtext-secondary line-clamp-2">
            {notification.message}
          </p>
          {notification.actionUrl && (
            <Link
              href={notification.actionUrl}
              className="mt-1 flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              查看详情
            </Link>
          )}
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
