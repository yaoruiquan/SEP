'use client';

import { useEffect, useState } from 'react';
import { Download, FileText, Film, ImageOff, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatBytes, resolveAttachmentUrl } from '@/lib/upload';
import type { MessageAttachment } from '@/lib/types';

interface AttachmentDisplayProps {
  attachments: MessageAttachment[];
  /** 用户气泡是深色底，配色要反过来 */
  onPrimary?: boolean;
}

/** 已发送消息里的附件列表：图片成组显示，文档/视频各占一行。 */
export function AttachmentDisplay({
  attachments,
  onPrimary,
}: AttachmentDisplayProps) {
  const [lightbox, setLightbox] = useState<MessageAttachment | null>(null);

  if (attachments.length === 0) return null;

  const images = attachments.filter((a) => a.type === 'image');
  const others = attachments.filter((a) => a.type !== 'image');

  return (
    <div className="space-y-1.5">
      {images.length > 0 && (
        <div
          className={cn(
            'grid gap-1.5',
            images.length === 1 ? 'grid-cols-1' : 'grid-cols-2',
          )}
        >
          {images.map((img) => (
            <ImageThumb
              key={img.key}
              attachment={img}
              solo={images.length === 1}
              onOpen={() => setLightbox(img)}
            />
          ))}
        </div>
      )}

      {others.map((a) => (
        <FileCard key={a.key} attachment={a} onPrimary={onPrimary} />
      ))}

      {lightbox && (
        <Lightbox attachment={lightbox} onClose={() => setLightbox(null)} />
      )}
    </div>
  );
}

function ImageThumb({
  attachment,
  solo,
  onOpen,
}: {
  attachment: MessageAttachment;
  solo: boolean;
  onOpen: () => void;
}) {
  const [broken, setBroken] = useState(false);
  const src = resolveAttachmentUrl(attachment.url);

  if (broken) {
    return (
      <div className="flex h-24 items-center justify-center gap-2 rounded-xl bg-black/10 px-3 text-xs text-white/80">
        <ImageOff className="h-4 w-4" />
        <span className="truncate">{attachment.name}</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'group relative overflow-hidden rounded-xl bg-black/10',
        solo ? 'max-h-64' : 'h-32',
      )}
      title={attachment.name}
    >
      {/* 附件是签名 URL（本地驱动带 exp/sig，OSS 带 Signature），
          next/image 的优化器无法代理这类地址，故用原生 img */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={attachment.name}
        onError={() => setBroken(true)}
        className={cn(
          'w-full object-cover transition-opacity group-hover:opacity-90',
          solo ? 'max-h-64 object-contain' : 'h-32',
        )}
      />
    </button>
  );
}

function FileCard({
  attachment,
  onPrimary,
}: {
  attachment: MessageAttachment;
  onPrimary?: boolean;
}) {
  const Icon = attachment.type === 'video' ? Film : FileText;
  const href = resolveAttachmentUrl(attachment.url);

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'flex items-center gap-2.5 rounded-xl border px-2.5 py-2 transition-colors',
        onPrimary
          ? 'border-white/25 bg-white/10 hover:bg-white/20'
          : 'border-border bg-muted/50 hover:bg-muted',
      )}
    >
      <Icon
        className={cn(
          'h-4 w-4 shrink-0',
          onPrimary ? 'text-primary-foreground/80' : 'text-fg-muted',
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium" title={attachment.name}>
          {attachment.name}
        </p>
        <p
          className={cn(
            'text-[11px]',
            onPrimary ? 'text-primary-foreground/70' : 'text-fg-subtle',
          )}
        >
          {formatBytes(attachment.size)}
        </p>
      </div>
      <Download
        className={cn(
          'h-3.5 w-3.5 shrink-0',
          onPrimary ? 'text-primary-foreground/70' : 'text-fg-subtle',
        )}
      />
    </a>
  );
}

function Lightbox({
  attachment,
  onClose,
}: {
  attachment: MessageAttachment;
  onClose: () => void;
}) {
  // Esc 关闭：图片放大后键盘用户没有别的退出方式
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={attachment.name}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
        aria-label="关闭"
      >
        <X className="h-5 w-5" />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={resolveAttachmentUrl(attachment.url)}
        alt={attachment.name}
        onClick={(e) => e.stopPropagation()}
        className="max-h-full max-w-full rounded-lg object-contain"
      />
    </div>
  );
}
