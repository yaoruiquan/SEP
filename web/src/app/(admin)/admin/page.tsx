'use client';

import Link from 'next/link';
import { ShieldCheck, Users, Zap } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/feedback';
import { Badge } from '@/components/ui/badge';
import { useAllCapabilities } from '@/features/admin/use-admin';
import { useEmployees } from '@/features/employee/use-employees';
import { CAPABILITY_TYPE_META } from '@/lib/utils';

function StatCard({
  label,
  value,
  icon: Icon,
  loading,
}: {
  label: string;
  value: number | undefined;
  icon: React.ElementType;
  loading: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-fg-muted">{label}</CardTitle>
        <Icon className="h-4 w-4 text-fg-subtle" />
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-16" />
        ) : (
          <p className="text-3xl font-bold">{value ?? 0}</p>
        )}
      </CardContent>
    </Card>
  );
}

export default function AdminDashboardPage() {
  const pendingQuery = useAllCapabilities('PENDING');
  const allCapQuery = useAllCapabilities();
  const employeesQuery = useEmployees();

  const pendingItems = pendingQuery.data?.items ?? [];

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-semibold">仪表盘</h1>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="待审能力"
          value={pendingQuery.data?.items.length}
          icon={ShieldCheck}
          loading={pendingQuery.isLoading}
        />
        <StatCard
          label="全部员工"
          value={employeesQuery.data?.length}
          icon={Users}
          loading={employeesQuery.isLoading}
        />
        <StatCard
          label="全部能力"
          value={allCapQuery.data?.total}
          icon={Zap}
          loading={allCapQuery.isLoading}
        />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>待审核能力</CardTitle>
          <Link
            href="/admin/capabilities"
            className="text-sm text-primary hover:underline"
          >
            去审核 →
          </Link>
        </CardHeader>
        <CardContent className="p-0">
          {pendingQuery.isLoading ? (
            <div className="space-y-2 p-5">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : pendingItems.length === 0 ? (
            <p className="px-5 py-4 text-sm text-fg-subtle">暂无待审核能力</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-fg-muted">
                  <th className="px-5 py-2 text-left font-medium">名称</th>
                  <th className="px-5 py-2 text-left font-medium">类型</th>
                  <th className="px-5 py-2 text-left font-medium">提交时间</th>
                </tr>
              </thead>
              <tbody>
                {pendingItems.slice(0, 5).map((cap) => {
                  const meta = CAPABILITY_TYPE_META[cap.type];
                  return (
                    <tr key={cap.id} className="border-b border-border last:border-0">
                      <td className="px-5 py-3 font-medium">{cap.name}</td>
                      <td className="px-5 py-3">
                        {meta ? (
                          <Badge className={meta.tone}>{meta.label}</Badge>
                        ) : (
                          <Badge>{cap.type}</Badge>
                        )}
                      </td>
                      <td className="px-5 py-3 text-fg-muted">
                        {new Date(cap.createdAt).toLocaleDateString('zh-CN')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
