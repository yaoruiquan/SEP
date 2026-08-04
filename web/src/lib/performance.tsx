/**
 * Performance Optimization Components
 *
 * 性能优化组件：图片懒加载、虚拟滚动等
 */

import { useEffect, useRef, useState, useMemo } from 'react';
import { cn } from '@/lib/utils';

/**
 * 懒加载图片组件
 *
 * 使用 Intersection Observer API 实现图片懒加载
 *
 * @example
 * ```tsx
 * <LazyImage
 *   src="/path/to/image.jpg"
 *   alt="描述"
 *   className="w-full h-64 object-cover"
 *   placeholder="/path/to/placeholder.jpg"
 * />
 * ```
 */
export function LazyImage({
  src,
  alt,
  className,
  placeholder,
  threshold = 0.1,
  onLoad,
  ...props
}: React.ImgHTMLAttributes<HTMLImageElement> & {
  placeholder?: string;
  threshold?: number;
  onLoad?: () => void;
}) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [isInView, setIsInView] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (!imgRef.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true);
          observer.disconnect();
        }
      },
      { threshold }
    );

    observer.observe(imgRef.current);

    return () => observer.disconnect();
  }, [threshold]);

  return (
    <img
      ref={imgRef}
      src={isInView ? src : placeholder}
      alt={alt}
      className={cn(
        'transition-opacity duration-300',
        isLoaded ? 'opacity-100' : 'opacity-0',
        className
      )}
      onLoad={() => {
        setIsLoaded(true);
        onLoad?.();
      }}
      loading="lazy"
      {...props}
    />
  );
}

/**
 * 虚拟滚动列表组件
 *
 * 只渲染可见区域的元素，大幅提升长列表性能
 *
 * @example
 * ```tsx
 * <VirtualList
 *   items={data}
 *   itemHeight={60}
 *   containerHeight={400}
 *   renderItem={(item) => <ItemCard key={item.id} data={item} />}
 * />
 * ```
 */
export function VirtualList<T>({
  items,
  itemHeight,
  containerHeight,
  renderItem,
  overscan = 3,
  className,
}: {
  items: T[];
  itemHeight: number;
  containerHeight: number;
  renderItem: (item: T, index: number) => React.ReactNode;
  overscan?: number;
  className?: string;
}) {
  const [scrollTop, setScrollTop] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const { visibleItems, totalHeight, offsetY } = useMemo(() => {
    const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const endIndex = Math.min(
      items.length - 1,
      Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan
    );

    const visibleItems = items.slice(startIndex, endIndex + 1);
    const totalHeight = items.length * itemHeight;
    const offsetY = startIndex * itemHeight;

    return { visibleItems, totalHeight, offsetY, startIndex };
  }, [items, itemHeight, containerHeight, scrollTop, overscan]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  };

  return (
    <div
      ref={containerRef}
      className={cn('overflow-auto', className)}
      style={{ height: containerHeight }}
      onScroll={handleScroll}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div style={{ transform: `translateY(${offsetY}px)` }}>
          {visibleItems.map((item, index) => (
            <div key={index} style={{ height: itemHeight }}>
              {renderItem(item, index)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * 无限滚动加载组件
 *
 * @example
 * ```tsx
 * <InfiniteScroll
 *   hasMore={hasNextPage}
 *   isLoading={isFetching}
 *   onLoadMore={() => fetchNextPage()}
 * >
 *   {items.map(item => <Card key={item.id} data={item} />)}
 * </InfiniteScroll>
 * ```
 */
export function InfiniteScroll({
  children,
  hasMore,
  isLoading,
  onLoadMore,
  threshold = 200,
  loader,
}: {
  children: React.ReactNode;
  hasMore: boolean;
  isLoading: boolean;
  onLoadMore: () => void;
  threshold?: number;
  loader?: React.ReactNode;
}) {
  const observerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!observerRef.current || !hasMore || isLoading) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          onLoadMore();
        }
      },
      { rootMargin: `${threshold}px` }
    );

    observer.observe(observerRef.current);

    return () => observer.disconnect();
  }, [hasMore, isLoading, onLoadMore, threshold]);

  return (
    <>
      {children}
      {hasMore && (
        <div ref={observerRef} className="py-4 text-center">
          {isLoading && (
            loader || (
              <div className="flex items-center justify-center gap-2 text-sm text-neutral-500">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-300 border-t-primary" />
                加载中...
              </div>
            )
          )}
        </div>
      )}
    </>
  );
}

/**
 * 延迟渲染组件
 *
 * 延迟渲染非关键内容，优化初始加载性能
 *
 * @example
 * ```tsx
 * <DeferredRender delay={500}>
 *   <HeavyComponent />
 * </DeferredRender>
 * ```
 */
export function DeferredRender({
  children,
  delay = 0,
  fallback,
}: {
  children: React.ReactNode;
  delay?: number;
  fallback?: React.ReactNode;
}) {
  const [isReady, setIsReady] = useState(delay === 0);

  useEffect(() => {
    if (delay === 0) return;

    const timer = setTimeout(() => setIsReady(true), delay);
    return () => clearTimeout(timer);
  }, [delay]);

  if (!isReady) return <>{fallback}</>;

  return <>{children}</>;
}

/**
 * 可见性检测 Hook
 *
 * 检测元素是否在视口内
 *
 * @example
 * ```tsx
 * const ref = useRef<HTMLDivElement>(null);
 * const isVisible = useInView(ref);
 *
 * return <div ref={ref}>{isVisible && <ExpensiveComponent />}</div>;
 * ```
 */
export function useInView(
  ref: React.RefObject<HTMLElement>,
  options?: IntersectionObserverInit
): boolean {
  const [isInView, setIsInView] = useState(false);

  useEffect(() => {
    if (!ref.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => setIsInView(entry.isIntersecting),
      options
    );

    observer.observe(ref.current);

    return () => observer.disconnect();
  }, [ref, options]);

  return isInView;
}

/**
 * 防抖 Hook
 *
 * @example
 * ```tsx
 * const [searchTerm, setSearchTerm] = useState('');
 * const debouncedSearchTerm = useDebounce(searchTerm, 500);
 *
 * useEffect(() => {
 *   // 只在防抖值变化时执行搜索
 *   search(debouncedSearchTerm);
 * }, [debouncedSearchTerm]);
 * ```
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

/**
 * 节流 Hook
 *
 * @example
 * ```tsx
 * const handleScroll = useThrottle(() => {
 *   console.log('Scrolled');
 * }, 200);
 *
 * <div onScroll={handleScroll}>...</div>
 * ```
 */
export function useThrottle<T extends (...args: any[]) => any>(
  callback: T,
  delay: number
): T {
  const lastRun = useRef(Date.now());

  return ((...args) => {
    const now = Date.now();

    if (now - lastRun.current >= delay) {
      callback(...args);
      lastRun.current = now;
    }
  }) as T;
}

/**
 * 预加载资源 Hook
 *
 * @example
 * ```tsx
 * usePreload('/path/to/image.jpg', 'image');
 * usePreload('/path/to/script.js', 'script');
 * ```
 */
export function usePreload(href: string, as: 'image' | 'script' | 'style' | 'font') {
  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'preload';
    link.href = href;
    link.as = as;

    if (as === 'font') {
      link.crossOrigin = 'anonymous';
    }

    document.head.appendChild(link);

    return () => {
      document.head.removeChild(link);
    };
  }, [href, as]);
}
