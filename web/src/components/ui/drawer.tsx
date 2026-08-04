'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { useFocusTrap, useEscapeKey, useFocusReturn } from '@/lib/accessibility';
import { usePrefersReducedMotion, useIsMobile } from '@/lib/responsive';

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title?: string;
  width?: 'sm' | 'md' | 'lg' | 'xl';
  position?: 'right' | 'left';
  showOverlay?: boolean;
  closeOnOverlayClick?: boolean;
  closeOnEsc?: boolean;
}

const widthClasses = {
  sm: 'w-[400px]',
  md: 'w-[600px]',
  lg: 'w-[800px]',
  xl: 'w-[1000px]',
};

export function Drawer({
  open,
  onClose,
  children,
  title,
  width = 'md',
  position = 'right',
  showOverlay = true,
  closeOnOverlayClick = true,
  closeOnEsc = true,
}: DrawerProps) {
  const isMobile = useIsMobile();
  const prefersReducedMotion = usePrefersReducedMotion();

  // 使用无障碍工具（useFocusTrap 自己创建并返回 ref）
  const drawerRef = useFocusTrap<HTMLDivElement>(open);
  useFocusReturn(open);
  useEscapeKey(() => {
    if (closeOnEsc) onClose();
  }, open);

  // 防止body滚动
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  if (!open) return null;

  // 移动端全屏显示
  const drawerWidth = isMobile ? 'w-full' : widthClasses[width];

  const drawer = (
    <div
      className="fixed inset-0 z-50 flex"
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? 'drawer-title' : undefined}
    >
      {/* Overlay */}
      {showOverlay && (
        <div
          className={cn(
            'fixed inset-0 bg-neutral-900/60 backdrop-blur-sm',
            !prefersReducedMotion && 'animate-in fade-in duration-200'
          )}
          onClick={closeOnOverlayClick ? onClose : undefined}
          aria-hidden="true"
        />
      )}

      {/* Drawer panel */}
      <div
        ref={drawerRef}
        className={cn(
          'fixed top-0 bottom-0 bg-white shadow-modal flex flex-col z-50',
          drawerWidth,
          position === 'right' ? 'right-0' : 'left-0',
          !prefersReducedMotion &&
            position === 'right'
            ? 'animate-in slide-in-from-right duration-300'
            : 'animate-in slide-in-from-left duration-300'
        )}
      >
        {/* Header */}
        {title && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200">
            <h2
              id="drawer-title"
              className="text-lg font-semibold text-neutral-900"
            >
              {title}
            </h2>
            <button
              onClick={onClose}
              className="p-2 rounded-md hover:bg-neutral-100 transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
              aria-label="关闭"
            >
              <svg
                className="w-5 h-5 text-neutral-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">{children}</div>
      </div>
    </div>
  );

  return createPortal(drawer, document.body);
}

// 快捷组件：DrawerHeader, DrawerBody, DrawerFooter
export function DrawerHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-6 py-4 border-b border-neutral-200">{children}</div>
  );
}

export function DrawerBody({ children }: { children: React.ReactNode }) {
  return <div className="flex-1 overflow-y-auto px-6 py-4">{children}</div>;
}

export function DrawerFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-6 py-4 border-t border-neutral-200 flex items-center justify-end gap-3">
      {children}
    </div>
  );
}
