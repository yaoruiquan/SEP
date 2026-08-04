import { cn } from '@/lib/utils';
import { Button } from './button';
import { AlertTriangle, RefreshCw, Home, ChevronDown } from 'lucide-react';
import { useState } from 'react';

interface ErrorStateProps {
  title?: string;
  message?: string;
  error?: Error | string;
  onRetry?: () => void;
  onGoHome?: () => void;
  showDetails?: boolean;
  className?: string;
}

/**
 * 页面级错误状态组件
 *
 * 用于网络错误、API 错误、页面加载失败等场景
 *
 * @example
 * ```tsx
 * <ErrorState
 *   title="出错了"
 *   message="加载数据时遇到问题，请稍后重试"
 *   error={error}
 *   onRetry={() => refetch()}
 *   onGoHome={() => router.push('/')}
 * />
 * ```
 */
export function ErrorState({
  title = '出错了',
  message = '加载数据时遇到问题，请稍后重试',
  error,
  onRetry,
  onGoHome,
  showDetails = true,
  className,
}: ErrorStateProps) {
  const [detailsExpanded, setDetailsExpanded] = useState(false);

  const errorMessage = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const errorStack = error instanceof Error ? error.stack : '';

  return (
    <div className={cn('flex flex-col items-center justify-center py-16 px-6 text-center', className)}>
      {/* 错误图标 */}
      <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-danger/10">
        <AlertTriangle className="h-12 w-12 text-danger" />
      </div>

      {/* 标题 */}
      <h2 className="text-lg font-semibold text-neutral-900 mb-2">{title}</h2>

      {/* 描述 */}
      <p className="text-sm text-neutral-600 max-w-md mb-6">{message}</p>

      {/* 操作按钮 */}
      <div className="flex items-center gap-3">
        {onRetry && (
          <Button onClick={onRetry}>
            <RefreshCw className="h-4 w-4 mr-1.5" />
            刷新页面
          </Button>
        )}
        {onGoHome && (
          <Button variant="outline" onClick={onGoHome}>
            <Home className="h-4 w-4 mr-1.5" />
            返回首页
          </Button>
        )}
      </div>

      {/* 错误详情（可展开） */}
      {showDetails && errorMessage && (
        <div className="mt-6 w-full max-w-2xl">
          <button
            onClick={() => setDetailsExpanded(!detailsExpanded)}
            className="flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-700 transition-colors mx-auto"
          >
            <ChevronDown
              className={cn(
                'h-3.5 w-3.5 transition-transform',
                detailsExpanded && 'rotate-180'
              )}
            />
            查看错误详情
          </button>

          {detailsExpanded && (
            <div className="mt-3 rounded-lg bg-neutral-50 border border-neutral-200 p-4 text-left">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-xs font-medium text-neutral-700">错误信息</span>
              </div>
              <pre className="text-xs text-neutral-600 whitespace-pre-wrap break-words font-mono">
                {errorMessage}
              </pre>
              {errorStack && (
                <>
                  <div className="mt-3 mb-2 flex items-center gap-2">
                    <span className="text-xs font-medium text-neutral-700">堆栈跟踪</span>
                  </div>
                  <pre className="text-xs text-neutral-500 whitespace-pre-wrap break-words font-mono max-h-40 overflow-y-auto">
                    {errorStack}
                  </pre>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 内联错误提示
 *
 * 用于表单、区块内的错误提示
 *
 * @example
 * ```tsx
 * <InlineError
 *   title="保存失败"
 *   message="网络连接异常，请检查网络后重试"
 * />
 * ```
 */
export function InlineError({
  title,
  message,
  className,
}: {
  title: string;
  message?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex gap-3 rounded-lg bg-danger/5 border border-danger/20 p-4',
        className
      )}
      role="alert"
    >
      <AlertTriangle className="h-5 w-5 text-danger shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm text-danger">{title}</p>
        {message && <p className="mt-1 text-sm text-neutral-600">{message}</p>}
      </div>
    </div>
  );
}

/**
 * 表单字段错误提示
 *
 * @example
 * ```tsx
 * <Input error={!!errors.email} />
 * {errors.email && <FieldError message={errors.email.message} />}
 * ```
 */
export function FieldError({
  message,
  className,
}: {
  message: string;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-1 mt-1.5 text-xs text-danger', className)}>
      <AlertTriangle className="h-3 w-3 shrink-0" />
      <span>{message}</span>
    </div>
  );
}
