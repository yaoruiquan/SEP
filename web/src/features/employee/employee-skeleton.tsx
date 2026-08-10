import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

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

// 我的硅基员工页面卡片骨架屏
export function MyEmployeeCardSkeleton() {
  return (
    <Card className="border-2">
      {/* 卡片头部 */}
      <CardHeader className="border-b bg-gradient-to-br from-primary/5 via-orange-50/30 to-transparent p-5">
        <div className="flex items-start gap-4">
          {/* 头像 */}
          <div className="relative shrink-0">
            <Skeleton className="h-14 w-14 rounded-full" />
          </div>

          {/* 名称 + 版本 */}
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-5 w-20 mt-2" />
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 p-5">
        {/* 授权信息 */}
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-6 w-20" />
          <Skeleton className="h-6 w-32" />
        </div>

        {/* 统计数据 */}
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-20 rounded-lg" />
          <Skeleton className="h-20 rounded-lg" />
        </div>

        {/* 操作按钮 */}
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
          </div>
          <Skeleton className="h-9 w-full" />
        </div>
      </CardContent>
    </Card>
  );
}

export function MyEmployeeListSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <MyEmployeeCardSkeleton key={i} />
      ))}
    </div>
  );
}
