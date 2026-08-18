'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton, EmptyState } from '@/components/ui/feedback';
import { Avatar } from '@/components/ui/avatar';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/features/admin/admin-api';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, Archive, Upload, Users, Palette } from 'lucide-react';

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
  const router = useRouter();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'approved' | 'draft' | 'pending'>('approved');
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; employeeId: string; employeeName: string }>({
    open: false,
    employeeId: '',
    employeeName: '',
  });

  const { data: employeesResponse, isLoading, isError, error } = useQuery({
    queryKey: ['admin-employees', tab],
    queryFn: async () => {
      const statusMap = {
        approved: 'APPROVED',
        draft: 'DRAFT',
        pending: 'PENDING',
      };
      return adminApi.listEmployees({ status: statusMap[tab] as any });
    },
  });

  const employees = employeesResponse?.data || [];

  const publishMutation = useMutation({
    mutationFn: (id: string) => adminApi.publishEmployee(id),
    onSuccess: () => {
      toast.success('员工发布成功');
      queryClient.invalidateQueries({ queryKey: ['admin-employees'] });
    },
    onError: (error: any) => {
      toast.error(error.message || '发布失败');
    },
  });

  const submitForReviewMutation = useMutation({
    mutationFn: (id: string) => adminApi.submitEmployeeForReview(id),
    onSuccess: () => {
      toast.success('已提交审核');
      queryClient.invalidateQueries({ queryKey: ['admin-employees'] });
    },
    onError: (error: any) => {
      toast.error(error.message || '提交失败');
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (id: string) => adminApi.archiveEmployee(id),
    onSuccess: () => {
      toast.success('员工已下架');
      queryClient.invalidateQueries({ queryKey: ['admin-employees'] });
    },
    onError: (error: any) => {
      toast.error(error.message || '下架失败');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => adminApi.deleteEmployee(id),
    onSuccess: () => {
      toast.success('员工已删除');
      queryClient.invalidateQueries({ queryKey: ['admin-employees'] });
      setDeleteDialog({ open: false, employeeId: '', employeeName: '' });
    },
    onError: (error: any) => {
      toast.error(error.message || '删除失败');
    },
  });

  const handleDelete = (id: string, name: string) => {
    setDeleteDialog({ open: true, employeeId: id, employeeName: name });
  };

  const confirmDelete = () => {
    if (deleteDialog.employeeId) {
      deleteMutation.mutate(deleteDialog.employeeId);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">员工管理</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => router.push('/admin/employees/avatar-styles')}
          >
            <Palette className="h-4 w-4 mr-2" />
            头像风格
          </Button>
          <Button onClick={() => router.push('/admin/employees/new')}>
            <Plus className="h-4 w-4 mr-2" />
            新建员工
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v: any) => setTab(v)}>
        <TabsList>
          <TabsTrigger value="approved">已发布</TabsTrigger>
          <TabsTrigger value="draft">草稿</TabsTrigger>
          <TabsTrigger value="pending">待审核</TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="mt-4">
          <Card variant="solid">
            <CardHeader>
              <CardTitle>
                {tab === 'approved' && '已发布员工'}
                {tab === 'draft' && '草稿员工'}
                {tab === 'pending' && '待审核员工'}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="space-y-2 p-5">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : isError ? (
                <div className="px-5 py-8">
                  <EmptyState
                    icon={<Users className="h-8 w-8" />}
                    title="加载失败"
                    description={error?.message || '无法加载员工列表，请稍后重试。'}
                    action={
                      <Button size="sm" onClick={() => window.location.reload()}>
                        刷新页面
                      </Button>
                    }
                  />
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
                      <th className="px-5 py-2 text-left font-medium">定价</th>
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
                          {emp.annualPriceCNY && Number(emp.annualPriceCNY) > 0 ? (
                            <div className="flex flex-col">
                              <span className="text-sm font-medium">
                                ¥{Number(emp.annualPriceCNY).toLocaleString()}/年
                              </span>
                              <span className="text-xs text-fg-subtle">
                                含 ¥{Number(emp.includedComputeCNY || 0).toLocaleString()} 算力
                              </span>
                            </div>
                          ) : (
                            <span className="text-sm text-success">免费</span>
                          )}
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
                                查看
                              </Button>
                            </Link>

                            {emp.status === 'DRAFT' && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => router.push(`/admin/employees/${emp.id}/edit`)}
                                >
                                  <Pencil className="h-3.5 w-3.5 mr-1" />
                                  编辑
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => submitForReviewMutation.mutate(emp.id)}
                                  disabled={submitForReviewMutation.isPending}
                                >
                                  <Upload className="h-3.5 w-3.5 mr-1" />
                                  提交审核
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleDelete(emp.id, emp.name)}
                                  disabled={deleteMutation.isPending}
                                >
                                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                                  删除
                                </Button>
                              </>
                            )}

                            {emp.status === 'APPROVED' && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => router.push(`/admin/employees/${emp.id}/edit`)}
                                >
                                  <Pencil className="h-3.5 w-3.5 mr-1" />
                                  编辑
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => archiveMutation.mutate(emp.id)}
                                  disabled={archiveMutation.isPending}
                                >
                                  <Archive className="h-3.5 w-3.5 mr-1" />
                                  下架
                                </Button>
                              </>
                            )}

                            {emp.status === 'PENDING' && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => router.push(`/admin/employees/${emp.id}`)}
                                >
                                  审核
                                </Button>
                              </>
                            )}
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

      <AlertDialog open={deleteDialog.open} onOpenChange={(open) => setDeleteDialog({ ...deleteDialog, open })}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除员工 "{deleteDialog.employeeName}" 吗？此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
