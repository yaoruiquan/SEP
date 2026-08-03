import { Skeleton } from '@/components/ui/skeleton';
import { Card } from '@/components/ui/card';

export function TaskCardSkeleton() {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0 space-y-3">
          {/* 标题和状态 */}
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-5 w-16" />
          </div>

          {/* 员工和发起人 */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <Skeleton className="h-5 w-5" variant="circular" />
              <Skeleton className="h-4 w-20" />
            </div>
            <Skeleton className="h-3 w-1" />
            <div className="flex items-center gap-1.5">
              <Skeleton className="h-5 w-5" variant="circular" />
              <Skeleton className="h-4 w-24" />
            </div>
          </div>

          {/* 时间和进度 */}
          <div className="flex items-center gap-3">
            <Skeleton className="h-3 w-32" />
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="flex items-center gap-2 shrink-0">
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-16" />
        </div>
      </div>
    </Card>
  );
}

export function TaskListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-3 max-w-5xl">
      {Array.from({ length: count }).map((_, i) => (
        <TaskCardSkeleton key={i} />
      ))}
    </div>
  );
}
