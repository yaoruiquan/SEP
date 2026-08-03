'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

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
  const drawerRef = useRef<HTMLDivElement>(null);

  // ESC键关闭
  useEffect(() => {
    if (!open || !closeOnEsc) return;

    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [open, closeOnEsc, onClose]);

  // Focus trap
  useEffect(() => {
    if (!open) return;

    const drawer = drawerRef.current;
    if (!drawer) return;

    const focusableElements = drawer.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement?.focus();
        }
      } else {
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement?.focus();
        }
      }
    };

    drawer.addEventListener('keydown', handleTab as any);
    firstElement?.focus();

    return () => drawer.removeEventListener('keydown', handleTab as any);
  }, [open]);

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
          className="fixed inset-0 bg-black/50 animate-fade-in"
          onClick={closeOnOverlayClick ? onClose : undefined}
          aria-hidden="true"
        />
      )}

      {/* Drawer panel */}
      <div
        ref={drawerRef}
        className={cn(
          'fixed top-0 bottom-0 bg-white shadow-2xl flex flex-col',
          widthClasses[width],
          position === 'right'
            ? 'right-0 animate-slide-in-right'
            : 'left-0 -scale-x-100 animate-slide-in-right scale-x-100',
          'z-50'
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
              className="p-2 rounded-lg hover:bg-neutral-100 transition-colors"
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
