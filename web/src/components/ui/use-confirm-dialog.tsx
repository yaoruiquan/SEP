'use client';

import { useCallback, useRef, useState } from 'react';
import { ConfirmDialog } from './confirm-dialog';

export interface ConfirmOptions {
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'default' | 'danger';
}

interface ConfirmState {
  open: boolean;
  options: ConfirmOptions;
}

/**
 * Promise 化的确认弹窗，替代原生 `confirm()`。
 *
 * 原生 `confirm()` 阻塞主线程、样式不可控、在暗色/移动端与产品割裂。
 * 这里复用已有的 `ConfirmDialog`（Radix，自带 focus trap / ESC / aria），
 * 调用方写法保持与原 `confirm()` 几乎一致：
 *
 * ```tsx
 * const { confirm, dialog } = useConfirmDialog();
 * // ...
 * if (await confirm({ title: '删除', description: '确定吗？', variant: 'danger' })) {
 *   await remove();
 * }
 * // JSX 末尾渲染 {dialog}
 * ```
 */
export function useConfirmDialog() {
  const [state, setState] = useState<ConfirmState>({ open: false, options: { title: '', description: '' } });
  // 用 ref 持有 resolve，避免闭包拿到过期 state；同一时刻只会有一个待决确认。
  const resolveRef = useRef<((value: boolean) => void) | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    const activeElement = document.activeElement;
    triggerRef.current = activeElement instanceof HTMLElement ? activeElement : null;
    // 若已有未决确认（理论上不会发生），先以 false 收尾，避免 Promise 永久挂起。
    resolveRef.current?.(false);
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
      setState({ open: true, options });
    });
  }, []);

  const settle = useCallback((value: boolean) => {
    resolveRef.current?.(value);
    resolveRef.current = null;
    setState((s) => ({ ...s, open: false }));
  }, []);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      // 用户点取消 / 按 ESC / 点遮罩关闭 → 视为「未确认」。
      if (!open) settle(false);
    },
    [settle],
  );

  const handleConfirm = useCallback(() => settle(true), [settle]);

  const handleCloseAutoFocus = useCallback((event: Event) => {
    const trigger = triggerRef.current;
    triggerRef.current = null;
    if (!trigger?.isConnected) return;

    event.preventDefault();
    trigger.focus();
  }, []);

  const dialog = (
    <ConfirmDialog
      open={state.open}
      onOpenChange={handleOpenChange}
      title={state.options.title}
      description={state.options.description}
      confirmText={state.options.confirmText}
      cancelText={state.options.cancelText}
      variant={state.options.variant}
      onConfirm={handleConfirm}
      onCloseAutoFocus={handleCloseAutoFocus}
    />
  );

  return { confirm, dialog };
}
