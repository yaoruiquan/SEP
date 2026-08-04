/**
 * Accessibility Utilities
 *
 * 可访问性工具函数和 Hooks
 */

import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * 焦点陷阱 Hook
 *
 * 用于 Modal、Drawer 等组件，确保焦点不会跳出容器
 *
 * @example
 * ```tsx
 * const dialogRef = useFocusTrap<HTMLDivElement>(isOpen);
 *
 * return (
 *   <div ref={dialogRef} role="dialog">
 *     {children}
 *   </div>
 * );
 * ```
 */
export function useFocusTrap<T extends HTMLElement>(active: boolean = true) {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!active || !ref.current) return;

    const element = ref.current;
    const focusableElements = element.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    // 聚焦第一个元素
    firstElement?.focus();

    const handleTabKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      if (e.shiftKey) {
        // Shift + Tab: 如果在第一个元素，跳到最后一个
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement?.focus();
        }
      } else {
        // Tab: 如果在最后一个元素，跳到第一个
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement?.focus();
        }
      }
    };

    element.addEventListener('keydown', handleTabKey);

    return () => {
      element.removeEventListener('keydown', handleTabKey);
    };
  }, [active]);

  return ref;
}

/**
 * Escape 键关闭 Hook
 *
 * @example
 * ```tsx
 * useEscapeKey(() => setOpen(false), isOpen);
 * ```
 */
export function useEscapeKey(onEscape: () => void, enabled: boolean = true) {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onEscape();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onEscape, enabled]);
}

/**
 * 焦点返回 Hook
 *
 * 记住打开前的焦点元素，关闭后恢复
 *
 * @example
 * ```tsx
 * useFocusReturn(isOpen);
 * ```
 */
export function useFocusReturn(isOpen: boolean) {
  const previouslyFocusedElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      // 记住当前焦点元素
      previouslyFocusedElement.current = document.activeElement as HTMLElement;
    } else {
      // 关闭时恢复焦点
      previouslyFocusedElement.current?.focus();
    }
  }, [isOpen]);
}

/**
 * 唯一 ID 生成 Hook
 *
 * 用于 ARIA 属性（aria-labelledby, aria-describedby）
 *
 * @example
 * ```tsx
 * const titleId = useId('dialog-title');
 * const descId = useId('dialog-desc');
 *
 * return (
 *   <div role="dialog" aria-labelledby={titleId} aria-describedby={descId}>
 *     <h2 id={titleId}>标题</h2>
 *     <p id={descId}>描述</p>
 *   </div>
 * );
 * ```
 */
export function useId(prefix: string = 'id'): string {
  const [id] = useState(() => `${prefix}-${Math.random().toString(36).slice(2, 9)}`);
  return id;
}

/**
 * 键盘导航 Hook
 *
 * 用于列表、菜单等组件的方向键导航
 *
 * @example
 * ```tsx
 * const { focusedIndex, setFocusedIndex, handleKeyDown } = useKeyboardNavigation({
 *   itemCount: items.length,
 *   onSelect: (index) => selectItem(items[index]),
 * });
 * ```
 */
export function useKeyboardNavigation({
  itemCount,
  onSelect,
  loop = true,
  orientation = 'vertical',
}: {
  itemCount: number;
  onSelect?: (index: number) => void;
  loop?: boolean;
  orientation?: 'vertical' | 'horizontal';
}) {
  const [focusedIndex, setFocusedIndex] = useState(-1);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const isVertical = orientation === 'vertical';
      const nextKey = isVertical ? 'ArrowDown' : 'ArrowRight';
      const prevKey = isVertical ? 'ArrowUp' : 'ArrowLeft';

      switch (e.key) {
        case nextKey:
          e.preventDefault();
          setFocusedIndex((prev) => {
            if (prev < itemCount - 1) return prev + 1;
            return loop ? 0 : prev;
          });
          break;

        case prevKey:
          e.preventDefault();
          setFocusedIndex((prev) => {
            if (prev > 0) return prev - 1;
            return loop ? itemCount - 1 : prev;
          });
          break;

        case 'Home':
          e.preventDefault();
          setFocusedIndex(0);
          break;

        case 'End':
          e.preventDefault();
          setFocusedIndex(itemCount - 1);
          break;

        case 'Enter':
        case ' ':
          e.preventDefault();
          if (focusedIndex >= 0 && onSelect) {
            onSelect(focusedIndex);
          }
          break;

        default:
          break;
      }
    },
    [itemCount, focusedIndex, onSelect, loop, orientation]
  );

  return {
    focusedIndex,
    setFocusedIndex,
    handleKeyDown,
  };
}

/**
 * 实时区域公告 Hook
 *
 * 用于屏幕阅读器实时播报（加载完成、操作成功等）
 *
 * @example
 * ```tsx
 * const announce = useAnnouncer();
 *
 * // 操作完成后
 * announce('数据已保存', 'polite');
 * announce('发生错误', 'assertive');
 * ```
 */
export function useAnnouncer() {
  const [announcements, setAnnouncements] = useState<Array<{ id: string; message: string; politeness: 'polite' | 'assertive' }>>([]);

  const announce = useCallback((message: string, politeness: 'polite' | 'assertive' = 'polite') => {
    const id = Math.random().toString(36).slice(2);
    setAnnouncements((prev) => [...prev, { id, message, politeness }]);

    // 3 秒后移除
    setTimeout(() => {
      setAnnouncements((prev) => prev.filter((a) => a.id !== id));
    }, 3000);
  }, []);

  return announce;
}

/**
 * 屏幕阅读器实时区域组件
 *
 * 在 layout 中添加一次即可
 *
 * @example
 * ```tsx
 * <LiveRegion />
 * ```
 */
export function LiveRegion() {
  return (
    <>
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        id="polite-announcer"
      />
      <div
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
        className="sr-only"
        id="assertive-announcer"
      />
    </>
  );
}

/**
 * 跳转到主内容链接
 *
 * 键盘用户可以快速跳过导航栏
 *
 * @example
 * ```tsx
 * <SkipToContent />
 * <nav>...</nav>
 * <main id="main-content">...</main>
 * ```
 */
export function SkipToContent({ targetId = 'main-content' }: { targetId?: string }) {
  return (
    <a
      href={`#${targetId}`}
      className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:rounded focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:text-white focus:shadow-lg"
    >
      跳转到主内容
    </a>
  );
}

/**
 * 屏幕阅读器专用文本组件
 *
 * @example
 * ```tsx
 * <button>
 *   <TrashIcon />
 *   <VisuallyHidden>删除</VisuallyHidden>
 * </button>
 * ```
 */
export function VisuallyHidden({ children }: { children: React.ReactNode }) {
  return <span className="sr-only">{children}</span>;
}
