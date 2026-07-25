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
  message: string;
}

interface ToastStore {
  toasts: ToastItem[];
  push: (tone: ToastTone, message: string) => void;
  dismiss: (id: string) => void;
}

// ─── Store ─────────────────────────────────────────────────────────────────

const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  push: (tone, message) => {
    const id = Math.random().toString(36).slice(2);
    set((s) => ({ toasts: [...s.toasts, { id, tone, message }] }));
    // auto-dismiss after 3s
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 3000);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

// ─── Public API ──────────────────────────────────────────────────────────────

/** Imperative toast API — call from anywhere: toast.success('已保存') */
export const toast = {
  success: (msg: string) => useToastStore.getState().push('success', msg),
  error: (msg: string) => useToastStore.getState().push('error', msg),
  warning: (msg: string) => useToastStore.getState().push('warning', msg),
  info: (msg: string) => useToastStore.getState().push('info', msg),
};

// ─── Renderer ────────────────────────────────────────────────────────────────

const TONE_META: Record<
  ToastTone,
  { icon: typeof CheckCircle2; tone: string }
> = {
  success: { icon: CheckCircle2, tone: 'border-success/30 text-success' },
  error: { icon: XCircle, tone: 'border-danger/30 text-danger' },
  warning: { icon: AlertTriangle, tone: 'border-warning/30 text-warning' },
  info: { icon: Info, tone: 'border-primary/30 text-primary' },
};

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[100] flex w-full max-w-sm flex-col gap-2">
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
  // trigger CSS enter transition on mount
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <div
      className={cn(
        'pointer-events-auto flex items-start gap-2.5 rounded-lg border bg-card px-3.5 py-2.5 shadow-lg',
        'transition-all duration-200 ease-out',
        shown ? 'translate-y-0 opacity-100' : '-translate-y-2 opacity-0',
        meta.tone,
      )}
      role="alert"
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="flex-1 whitespace-pre-line text-sm leading-relaxed text-foreground">
        {item.message}
      </p>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 text-fg-subtle transition-colors hover:text-foreground"
        aria-label="关闭"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
