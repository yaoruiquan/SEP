'use client';

import { create } from 'zustand';
import { useEffect, useState } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Types ─────────────────────────────────────────────────────────────────

export type ToastTone = 'success' | 'error' | 'warning' | 'info';

interface ToastItem {
  id: string;
  tone: ToastTone;
  title: string;
  description?: string;
  duration?: number;
}

interface ToastStore {
  toasts: ToastItem[];
  push: (tone: ToastTone, title: string, description?: string, duration?: number) => void;
  dismiss: (id: string) => void;
}

// ─── Store ─────────────────────────────────────────────────────────────────

const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  push: (tone, title, description, duration) => {
    const id = Math.random().toString(36).slice(2);
    const defaultDuration = tone === 'error' ? 5000 : 3000;
    const finalDuration = duration ?? defaultDuration;

    set((s) => {
      // 最多显示 3 个 Toast
      const newToasts = [...s.toasts, { id, tone, title, description, duration: finalDuration }];
      return { toasts: newToasts.slice(-3) };
    });

    // 自动消失
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, finalDuration);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

// ─── Public API ──────────────────────────────────────────────────────────────

/** Imperative toast API — call from anywhere */
export const toast = {
  success: (title: string, description?: string, duration?: number) =>
    useToastStore.getState().push('success', title, description, duration),
  error: (title: string, description?: string, duration?: number) =>
    useToastStore.getState().push('error', title, description, duration),
  warning: (title: string, description?: string, duration?: number) =>
    useToastStore.getState().push('warning', title, description, duration),
  info: (title: string, description?: string, duration?: number) =>
    useToastStore.getState().push('info', title, description, duration),
};

// ─── Renderer ────────────────────────────────────────────────────────────────

const TONE_META: Record<
  ToastTone,
  { icon: typeof CheckCircle2; borderColor: string; iconColor: string }
> = {
  success: { icon: CheckCircle2, borderColor: 'border-l-success', iconColor: 'text-success' },
  error: { icon: XCircle, borderColor: 'border-l-danger', iconColor: 'text-danger' },
  warning: { icon: AlertTriangle, borderColor: 'border-l-warning', iconColor: 'text-warning' },
  info: { icon: Info, borderColor: 'border-l-info', iconColor: 'text-info' },
};

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <div className="pointer-events-none fixed right-6 top-6 z-[100] flex w-full max-w-[480px] flex-col gap-3">
      {toasts.map((t) => (
        <ToastCard key={t.id} item={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const meta = TONE_META[item.tone];
  const Icon = meta.icon;
  const [shown, setShown] = useState(false);
  const [isExiting, setIsExiting] = useState(false);

  // 入场动画
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // 退出动画（提前 200ms）
  useEffect(() => {
    const exitTimer = setTimeout(() => {
      setIsExiting(true);
    }, (item.duration ?? 3000) - 200);

    return () => clearTimeout(exitTimer);
  }, [item.duration]);

  return (
    <div
      className={cn(
        'pointer-events-auto min-w-[320px] flex items-start gap-3 rounded-lg border-l-4 bg-white p-4 shadow-lg',
        'transition-all duration-200 ease-out',
        meta.borderColor,
        isExiting
          ? 'translate-x-8 opacity-0'
          : shown
          ? 'translate-x-0 opacity-100'
          : 'translate-x-full opacity-0'
      )}
      role="alert"
    >
      {/* 图标 */}
      <Icon className={cn('h-5 w-5 shrink-0 mt-0.5', meta.iconColor)} />

      {/* 内容 */}
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm text-neutral-900">{item.title}</p>
        {item.description && (
          <p className="mt-1 text-sm text-neutral-600 whitespace-pre-line">{item.description}</p>
        )}
      </div>

      {/* 关闭按钮 */}
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 rounded p-1 text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 transition-colors"
        aria-label="关闭"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
