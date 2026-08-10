import { cn } from '@/lib/utils';
import { Button } from './button';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
    variant?: 'primary' | 'secondary' | 'outline';
  };
  secondaryAction?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

/**
 * 空状态组件
 *
 * 用于列表为空、搜索无结果、功能未使用等场景
 *
 * @example
 * ```tsx
 * <EmptyState
 *   icon={<PackageIcon className="w-12 h-12 text-neutral-400" />}
 *   title="还没有招聘任何员工"
 *   description="从人才市场招聘硅基员工，开始自动化您的工作流程"
 *   action={{
 *     label: "去人才市场",
 *     onClick: () => router.push('/market'),
 *   }}
 * />
 * ```
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center py-12 px-6 text-center',
        className
      )}
    >
      {/* 图标 */}
      {icon && (
        <div className="mb-4 text-neutral-400">
          {icon}
        </div>
      )}

      {/* 主文案 */}
      <h3 className="text-lg font-medium text-neutral-900 mb-2">
        {title}
      </h3>

      {/* 副文案 */}
      {description && (
        <p className="text-sm text-neutral-600 max-w-md mb-6">
          {description}
        </p>
      )}

      {/* 操作按钮 */}
      {(action || secondaryAction) && (
        <div className="flex items-center gap-3">
          {action && (
            <Button
              variant={action.variant || 'primary'}
              onClick={action.onClick}
            >
              {action.label}
            </Button>
          )}
          {secondaryAction && (
            <Button
              variant="outline"
              onClick={secondaryAction.onClick}
            >
              {secondaryAction.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// 预设图标 - SVG 空状态插图

export function EmptyBoxIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="12" y="20" width="40" height="32" rx="2" stroke="currentColor" strokeWidth="2" fill="none" />
      <path d="M12 28h40" stroke="currentColor" strokeWidth="2" />
      <path d="M32 28v24" stroke="currentColor" strokeWidth="2" />
      <circle cx="32" cy="40" r="3" fill="currentColor" opacity="0.3" />
    </svg>
  );
}

export function EmptySearchIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="28" cy="28" r="12" stroke="currentColor" strokeWidth="2" />
      <path d="M37 37l10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M24 28h8M28 24v8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.3" />
    </svg>
  );
}

export function EmptyTaskIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="16" y="12" width="32" height="40" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M24 24h16M24 32h16M24 40h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.3" />
    </svg>
  );
}

export function EmptyFolderIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M12 20c0-2 1-3 3-3h10l4 4h20c2 0 3 1 3 3v20c0 2-1 3-3 3H15c-2 0-3-1-3-3V20z"
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
      />
      <circle cx="32" cy="34" r="4" fill="currentColor" opacity="0.2" />
    </svg>
  );
}

export function EmptyCheckIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="32" cy="32" r="16" stroke="currentColor" strokeWidth="2" opacity="0.3" />
      <path
        d="M24 32l6 6 10-10"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
