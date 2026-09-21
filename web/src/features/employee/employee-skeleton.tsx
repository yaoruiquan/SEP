import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/feedback';

export function EmployeeCardSkeleton() {
  return (
    <Card className="group relative flex flex-col overflow-hidden">
      {/* 顶部类型色带 */}
      <Skeleton className="h-1 w-full" />

      {/* 渐变头像区 */}
      <div className="relative h-32 bg-muted/50">
        {/* 头像容器 */}
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2">
          <Skeleton className="h-20 w-20 rounded-full" />
        </div>
      </div>

      <CardContent className="flex flex-1 flex-col gap-3 p-5 pt-12">
        {/* 名称居中 */}
        <div className="text-center space-y-2">
          <Skeleton className="h-6 w-32 mx-auto" />
          <Skeleton className="h-4 w-40 mx-auto" />
        </div>

        {/* 分隔线 */}
        <div className="mx-auto w-16 border-t border-border" />

        {/* 描述 */}
        <div className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4 mx-auto" />
        </div>

        {/* 擅长领域 */}
        <div className="space-y-2">
          <Skeleton className="h-4 w-20 mx-auto" />
          <div className="flex flex-wrap justify-center gap-1.5">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-5 w-20" />
          </div>
        </div>

        {/* 近期帮助 */}
        <Skeleton className="h-10 w-full rounded-lg" />

        {/* Stats row */}
        <div className="flex items-center justify-center gap-4 border-t border-border pt-3">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-12" />
        </div>

        {/* Actions */}
        <div className="flex flex-col items-center gap-2 pt-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-4 w-24" />
        </div>

        {/* Free trial hint */}
        <Skeleton className="h-3 w-40 mx-auto" />
      </CardContent>
    </Card>
  );
}

export function EmployeeListSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <EmployeeCardSkeleton key={i} />
      ))}
    </div>
  );
}

// 与硅基员工卡片保持相同的图片、摘要和操作占位。
export function MyEmployeeCardSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-3">
        <Skeleton className="h-[104px] w-[104px] shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1 space-y-3">
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>
      <div className="my-3 space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
      </div>
      <div className="space-y-3 border-t border-border py-3">
        {[0, 1, 2, 3].map((row) => (
          <Skeleton key={row} className="h-3 w-full" />
        ))}
      </div>
      <Skeleton className="mb-4 mt-2 h-6 w-full" />
      <Skeleton className="mb-4 h-10 w-4/5" />
      <div className="flex justify-between border-t border-border pt-3">
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-8 w-20" />
      </div>
    </div>
  );
}

export function MyEmployeeListSkeleton({
  count = 6,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div
      className={
        className ?? 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3'
      }
    >
      {Array.from({ length: count }).map((_, i) => (
        <MyEmployeeCardSkeleton key={i} />
      ))}
    </div>
  );
}
