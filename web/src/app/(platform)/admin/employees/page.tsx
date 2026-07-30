'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/feedback';
import { Avatar } from '@/components/ui/avatar';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

type EmployeeStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'DRAFT' | 'ARCHIVED';

const STATUS_META: Record<string, { label: string; tone: string }> = {
  DRAFT: { label: '草稿', tone: 'bg-muted text-fg-muted' },
  PENDING: { label: '待审核', tone: 'bg-warning/10 text-warning' },
  APPROVED: { label: '已发布', tone: 'bg-success/10 text-success' },
  REJECTED: { label: '已拒绝', tone: 'bg-danger/10 text-danger' },
  ARCHIVED: { label: '已归档', tone: 'bg-muted text-fg-subtle' },
};

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status];
  return <Badge className={meta?.tone ?? ''}>{meta?.label ?? status}</Badge>;
}

export default function AdminEmployeesPage() {
  const [tab, setTab] = useState<'pending' | 'approved' | 'all'>('pending');

  const { data: employees, isLoading } = useQuery({
    queryKey: ['admin-employees', tab],
    queryFn: async () => {
      const filter = tab === 'pending' ? '?status=PENDING' : tab === 'approved' ? '?status=APPROVED' : '';
      const res = await api.get<{ data: any[] }>(`/admin/employees${filter}`);
      return res.data || [];
    },
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">员工管理</h1>
      </div>

      <Tabs value={tab} onValueChange={(v: any) => setTab(v)}>
        <TabsList>
          <TabsTrigger value="pending">待审核</TabsTrigger>
          <TabsTrigger value="approved">已发布</TabsTrigger>
          <TabsTrigger value="all">全部</TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>
                {tab === 'pending' && '待审核员工'}
                {tab === 'approved' && '已发布员工'}
                {tab === 'all' && '全部员工'}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="space-y-2 p-5">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : !employees || employees.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-fg-subtle">
                  暂无数据
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40 text-fg-muted">
                      <th className="px-5 py-2 text-left font-medium">员工</th>
                      <th className="px-5 py-2 text-left font-medium">行业 / 岗位</th>
                      <th className="px-5 py-2 text-left font-medium">状态</th>
                      <th className="px-5 py-2 text-left font-medium">绑定能力</th>
                      <th className="px-5 py-2 text-right font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {employees.map((emp: any) => (
                      <tr
                        key={emp.id}
                        className="border-b border-border last:border-0 odd:bg-muted/20 transition-colors hover:bg-muted/40"
                      >
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <Avatar name={emp.name} />
                            <span className="font-medium">{emp.name}</span>
                          </div>
                        </td>
                        <td className="px-5 py-3 text-fg-muted">
                          {emp.industry} / {emp.position}
                        </td>
                        <td className="px-5 py-3">
                          <StatusBadge status={emp.status} />
                        </td>
                        <td className="px-5 py-3 text-fg-muted">
                          {emp._count?.bindings ?? emp.bindings?.length ?? 0}
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <Link href={`/admin/employees/${emp.id}`}>
                              <Button variant="ghost" size="sm">
                                详情
                              </Button>
                            </Link>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
