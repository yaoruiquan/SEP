'use client';

import {
  AlertCircle,
  FileText,
  Film,
  Loader2,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatBytes } from '@/lib/upload';
import type { PendingAttachment } from './use-attachment-upload';

interface FilePreviewProps {
  items: PendingAttachment[];
  onRemove: (id: string) => void;
}

/** 输入框上方的待发送附件条。空数组时不渲染任何东西。 */
export function FilePreview({ items, onRemove }: FilePreviewProps) {
  if (items.length === 0) return null;

  return (
    <div className="mb-2 flex flex-wrap gap-2">
      {items.map((item) => (
        <PreviewCard key={item.id} item={item} onRemove={onRemove} />
      ))}
    </div>
  );
}

function PreviewCard({
  item,
  onRemove,
}: {
  item: PendingAttachment;
  onRemove: (id: string) => void;
}) {
  const failed = item.status === 'error';

  return (
    <div
      className={cn(
        'group relative flex items-center gap-2 rounded-xl border bg-white py-1.5 pl-1.5 pr-7',
        failed ? 'border-danger/40 bg-danger/5' : 'border-border',
      )}
    >
      <Thumb item={item} />

      <div className="min-w-0 max-w-[160px]">
        <p className="truncate text-xs font-medium text-foreground" title={item.name}>
          {item.name}
        </p>
        <p
          className={cn(
            'truncate text-[11px]',
            failed ? 'text-danger' : 'text-fg-subtle',
          )}
          title={failed ? item.error : undefined}
        >
          {failed
            ? item.error
            : item.status === 'uploading'
              ? '上传中…'
              : formatBytes(item.size)}
        </p>
      </div>

      <button
        type="button"
        onClick={() => onRemove(item.id)}
        className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-muted text-fg-subtle transition-colors hover:bg-border hover:text-foreground"
        aria-label={`移除 ${item.name}`}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

function Thumb({ item }: { item: PendingAttachment }) {
  const base =
    'relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg';

  if (item.status === 'error') {
    return (
      <div className={cn(base, 'bg-danger/10')}>
        <AlertCircle className="h-4 w-4 text-danger" />
      </div>
    );
  }

  const overlay =
    item.status === 'uploading' ? (
      <div className="absolute inset-0 flex items-center justify-center bg-black/35">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-white" />
      </div>
    ) : null;

  if (item.previewUrl) {
    return (
      <div className={cn(base, 'bg-muted')}>
        {/* 本地 blob 预览，next/image 的优化对它没有意义 */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={item.previewUrl} alt={item.name} className="h-full w-full object-cover" />
        {overlay}
      </div>
    );
  }

  const Icon = item.type === 'video' ? Film : FileText;
  return (
    <div className={cn(base, 'bg-muted')}>
      <Icon className="h-4 w-4 text-fg-muted" />
      {overlay}
    </div>
  );
}
