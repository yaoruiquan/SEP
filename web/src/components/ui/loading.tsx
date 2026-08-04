'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

/**
 * 页面切换顶部进度条
 *
 * 在路由切换时自动显示，从 0% 递增到 90%，加载完成后快速到 100% 并淡出
 *
 * 使用：在 layout.tsx 中添加 <TopLoadingBar />
 */
export function TopLoadingBar() {
  const pathname = usePathname();
  const [progress, setProgress] = useState(0);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // 路由变化时启动进度条
    setIsVisible(true);
    setProgress(0);

    // 模拟加载进度：0 -> 30 -> 60 -> 90
    const timer1 = setTimeout(() => setProgress(30), 100);
    const timer2 = setTimeout(() => setProgress(60), 300);
    const timer3 = setTimeout(() => setProgress(90), 600);

    // 页面加载完成后快速到 100% 并淡出
    const completeTimer = setTimeout(() => {
      setProgress(100);
      setTimeout(() => {
        setIsVisible(false);
        setProgress(0);
      }, 200);
    }, 1000);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
      clearTimeout(completeTimer);
    };
  }, [pathname]);

  if (!isVisible) return null;

  return (
    <div
      className={cn(
        'fixed top-0 left-0 z-[9999] h-0.5 bg-primary transition-all duration-200 ease-out',
        progress === 100 && 'opacity-0'
      )}
      style={{ width: `${progress}%` }}
      role="progressbar"
      aria-valuenow={progress}
      aria-valuemin={0}
      aria-valuemax={100}
    />
  );
}

/**
 * Spinner 加载指示器
 *
 * 用于按钮内、局部区域的加载状态
 *
 * @example
 * ```tsx
 * <Button disabled={isLoading}>
 *   {isLoading && <LoadingSpinner className="mr-2" />}
 *   提交
 * </Button>
 * ```
 */
export function LoadingSpinner({
  size = 'md',
  className,
}: {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const sizeClasses = {
    sm: 'h-3 w-3 border',
    md: 'h-4 w-4 border-2',
    lg: 'h-6 w-6 border-2',
  };

  return (
    <div
      className={cn(
        'inline-block animate-spin rounded-full border-neutral-300 border-t-primary',
        sizeClasses[size],
        className
      )}
      role="status"
      aria-label="加载中"
    >
      <span className="sr-only">加载中...</span>
    </div>
  );
}

/**
 * 按钮加载状态
 *
 * 自动替换按钮内容为 Spinner + 文字
 *
 * @example
 * ```tsx
 * <Button disabled={isLoading}>
 *   <ButtonLoading isLoading={isLoading} text="提交中...">
 *     提交
 *   </ButtonLoading>
 * </Button>
 * ```
 */
export function ButtonLoading({
  isLoading,
  text = '加载中...',
  children,
}: {
  isLoading: boolean;
  text?: string;
  children: React.ReactNode;
}) {
  if (!isLoading) return <>{children}</>;

  return (
    <>
      <LoadingSpinner size="sm" className="mr-2" />
      {text}
    </>
  );
}

/**
 * 全屏加载遮罩
 *
 * 用于页面初始化、重要操作执行中等场景
 *
 * @example
 * ```tsx
 * {isInitializing && <FullPageLoading message="初始化中..." />}
 * ```
 */
export function FullPageLoading({
  message = '加载中...',
}: {
  message?: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-white/80 backdrop-blur-sm">
      <LoadingSpinner size="lg" />
      <p className="mt-4 text-sm text-neutral-600">{message}</p>
    </div>
  );
}

/**
 * 区块加载占位
 *
 * 用于卡片、表格等区域的加载状态
 *
 * @example
 * ```tsx
 * {isLoading ? (
 *   <BlockLoading height="h-64" />
 * ) : (
 *   <DataTable data={data} />
 * )}
 * ```
 */
export function BlockLoading({
  height = 'h-64',
  message,
  className,
}: {
  height?: string;
  message?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border border-neutral-200 bg-neutral-50',
        height,
        className
      )}
    >
      <LoadingSpinner size="md" />
      {message && <p className="mt-3 text-sm text-neutral-600">{message}</p>}
    </div>
  );
}
