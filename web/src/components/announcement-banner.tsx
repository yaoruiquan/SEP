'use client';

import { useActiveAnnouncements } from '@/features/announcement/use-announcements';
import { X, Info, AlertTriangle, AlertCircle, CheckCircle } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

const typeIcons = {
  INFO: Info,
  WARNING: AlertTriangle,
  ERROR: AlertCircle,
  SUCCESS: CheckCircle,
};

const typeStyles = {
  INFO: 'bg-blue-500/10 border-blue-500/20 text-blue-700 dark:text-blue-300',
  WARNING: 'bg-yellow-500/10 border-yellow-500/20 text-yellow-700 dark:text-yellow-300',
  ERROR: 'bg-red-500/10 border-red-500/20 text-red-700 dark:text-red-300',
  SUCCESS: 'bg-green-500/10 border-green-500/20 text-green-700 dark:text-green-300',
};

export function AnnouncementBanner() {
  const { data: announcements } = useActiveAnnouncements();
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  if (!announcements?.length) return null;

  const visibleAnnouncements = announcements.filter(
    (a) => !dismissedIds.has(a.id)
  );

  if (visibleAnnouncements.length === 0) return null;

  const handleDismiss = (id: string) => {
    setDismissedIds((prev) => new Set([...prev, id]));
  };

  return (
    <div className="space-y-2">
      {visibleAnnouncements.map((announcement) => {
        const Icon = typeIcons[announcement.type];
        return (
          <div
            key={announcement.id}
            className={cn(
              'flex items-start gap-3 rounded-lg border p-4',
              typeStyles[announcement.type]
            )}
          >
            <Icon className="h-5 w-5 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <h4 className="font-semibold text-sm">{announcement.title}</h4>
              <p className="text-sm mt-1 whitespace-pre-wrap">{announcement.content}</p>
            </div>
            <button
              onClick={() => handleDismiss(announcement.id)}
              className="shrink-0 rounded hover:bg-black/5 dark:hover:bg-white/5 p-1"
              aria-label="关闭"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
