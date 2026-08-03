import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export function AuditItemSkeleton() {
  return (
    <Card className="p-4 hover:shadow-md transition-shadow cursor-pointer">
      <div className="space-y-3">
        {/* 头部：标题 + 状态 */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
          <Skeleton className="h-6 w-16" />
        </div>

        {/* 描述 */}
        <div className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </div>

        {/* 元数据 */}
        <div className="flex items-center gap-4 pt-2 border-t">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
    </Card>
  );
}

export function AuditListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <AuditItemSkeleton key={i} />
      ))}
    </div>
  );
}
