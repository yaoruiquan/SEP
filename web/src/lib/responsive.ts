/**
 * Responsive Utilities
 *
 * 响应式布局工具和 Hooks
 */

import { useEffect, useState } from 'react';

/**
 * Tailwind 断点定义
 */
export const breakpoints = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
} as const;

export type Breakpoint = keyof typeof breakpoints;

/**
 * 响应式断点 Hook
 *
 * @example
 * ```tsx
 * const isMobile = useMediaQuery('(max-width: 768px)');
 * const isDesktop = useMediaQuery('(min-width: 1024px)');
 * ```
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(query);

    // 初始值
    setMatches(media.matches);

    // 监听变化
    const listener = (e: MediaQueryListEvent) => setMatches(e.matches);
    media.addEventListener('change', listener);

    return () => media.removeEventListener('change', listener);
  }, [query]);

  return matches;
}

/**
 * 当前断点 Hook
 *
 * @example
 * ```tsx
 * const breakpoint = useBreakpoint();
 * // 'sm' | 'md' | 'lg' | 'xl' | '2xl'
 * ```
 */
export function useBreakpoint(): Breakpoint {
  const [breakpoint, setBreakpoint] = useState<Breakpoint>('lg');

  useEffect(() => {
    const updateBreakpoint = () => {
      const width = window.innerWidth;
      if (width >= breakpoints['2xl']) setBreakpoint('2xl');
      else if (width >= breakpoints.xl) setBreakpoint('xl');
      else if (width >= breakpoints.lg) setBreakpoint('lg');
      else if (width >= breakpoints.md) setBreakpoint('md');
      else setBreakpoint('sm');
    };

    updateBreakpoint();
    window.addEventListener('resize', updateBreakpoint);
    return () => window.removeEventListener('resize', updateBreakpoint);
  }, []);

  return breakpoint;
}

/**
 * 是否移动端 Hook
 *
 * @example
 * ```tsx
 * const isMobile = useIsMobile();
 * ```
 */
export function useIsMobile(): boolean {
  return useMediaQuery(`(max-width: ${breakpoints.md - 1}px)`);
}

/**
 * 是否平板 Hook
 */
export function useIsTablet(): boolean {
  return useMediaQuery(`(min-width: ${breakpoints.md}px) and (max-width: ${breakpoints.lg - 1}px)`);
}

/**
 * 是否桌面端 Hook
 */
export function useIsDesktop(): boolean {
  return useMediaQuery(`(min-width: ${breakpoints.lg}px)`);
}

/**
 * 视口尺寸 Hook
 *
 * @example
 * ```tsx
 * const { width, height } = useViewportSize();
 * ```
 */
export function useViewportSize() {
  const [size, setSize] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 0,
    height: typeof window !== 'undefined' ? window.innerHeight : 0,
  });

  useEffect(() => {
    const handleResize = () => {
      setSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return size;
}

/**
 * 容器查询 Hook (实验性)
 *
 * @example
 * ```tsx
 * const containerRef = useRef<HTMLDivElement>(null);
 * const isNarrow = useContainerQuery(containerRef, 400);
 * ```
 */
export function useContainerQuery(
  ref: React.RefObject<HTMLElement>,
  maxWidth: number
): boolean {
  const [isNarrow, setIsNarrow] = useState(false);

  useEffect(() => {
    if (!ref.current) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setIsNarrow(entry.contentRect.width < maxWidth);
      }
    });

    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [ref, maxWidth]);

  return isNarrow;
}

/**
 * 响应式值 Hook
 *
 * 根据断点返回不同的值
 *
 * @example
 * ```tsx
 * const columns = useResponsiveValue({
 *   sm: 1,
 *   md: 2,
 *   lg: 3,
 *   xl: 4,
 * });
 * ```
 */
export function useResponsiveValue<T>(values: Partial<Record<Breakpoint, T>>): T | undefined {
  const breakpoint = useBreakpoint();

  // 从当前断点向下查找
  const orderedBreakpoints: Breakpoint[] = ['2xl', 'xl', 'lg', 'md', 'sm'];
  const currentIndex = orderedBreakpoints.indexOf(breakpoint);

  for (let i = currentIndex; i < orderedBreakpoints.length; i++) {
    const bp = orderedBreakpoints[i];
    if (values[bp] !== undefined) {
      return values[bp];
    }
  }

  return undefined;
}

/**
 * 响应式类名工具
 *
 * @example
 * ```tsx
 * <div className={responsiveClass({
 *   base: 'p-4',
 *   sm: 'p-6',
 *   lg: 'p-8',
 * })}>
 * ```
 */
export function responsiveClass(classes: Partial<Record<Breakpoint | 'base', string>>): string {
  const result: string[] = [];

  if (classes.base) result.push(classes.base);
  if (classes.sm) result.push(`sm:${classes.sm}`);
  if (classes.md) result.push(`md:${classes.md}`);
  if (classes.lg) result.push(`lg:${classes.lg}`);
  if (classes.xl) result.push(`xl:${classes.xl}`);
  if (classes['2xl']) result.push(`2xl:${classes['2xl']}`);

  return result.join(' ');
}

/**
 * 触摸设备检测 Hook
 */
export function useIsTouchDevice(): boolean {
  const [isTouch, setIsTouch] = useState(false);

  useEffect(() => {
    setIsTouch(
      'ontouchstart' in window ||
      navigator.maxTouchPoints > 0
    );
  }, []);

  return isTouch;
}

/**
 * 网络状态 Hook
 *
 * @example
 * ```tsx
 * const { isOnline, effectiveType } = useNetworkStatus();
 * // effectiveType: 'slow-2g' | '2g' | '3g' | '4g'
 * ```
 */
export function useNetworkStatus() {
  const [status, setStatus] = useState({
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    effectiveType: 'unknown' as string,
  });

  useEffect(() => {
    const handleOnline = () => setStatus((s) => ({ ...s, isOnline: true }));
    const handleOffline = () => setStatus((s) => ({ ...s, isOnline: false }));

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // 检测网络类型（如果支持）
    if ('connection' in navigator) {
      const connection = (navigator as any).connection;
      if (connection) {
        setStatus((s) => ({ ...s, effectiveType: connection.effectiveType || 'unknown' }));

        const handleChange = () => {
          setStatus((s) => ({ ...s, effectiveType: connection.effectiveType || 'unknown' }));
        };
        connection.addEventListener('change', handleChange);

        return () => {
          window.removeEventListener('online', handleOnline);
          window.removeEventListener('offline', handleOffline);
          connection.removeEventListener('change', handleChange);
        };
      }
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return status;
}

/**
 * Prefer Reduced Motion Hook
 *
 * 检测用户是否启用了减少动画
 *
 * @example
 * ```tsx
 * const prefersReducedMotion = usePrefersReducedMotion();
 *
 * <div className={prefersReducedMotion ? '' : 'animate-fade-in'}>
 * ```
 */
export function usePrefersReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}

/**
 * 暗黑模式偏好 Hook
 */
export function usePrefersDarkMode(): boolean {
  return useMediaQuery('(prefers-color-scheme: dark)');
}
