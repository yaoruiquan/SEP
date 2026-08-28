'use client';

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/feedback';
import { Avatar } from '@/components/ui/avatar';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { toast } from '@/components/ui/toast';
import { api } from '@/lib/api-client';
import { useEmployeeBindings, useRemoveBinding } from '@/features/admin/use-admin';
import { ArrowLeft, CheckCircle, XCircle } from 'lucide-react';

const STATUS_META: Record<string, { label: string; tone: string }> = {
  DRAFT: { label: '草稿', tone: 'bg-muted text-fg-muted' },
  PENDING: { label: '待审核', tone: 'bg-warning/10 text-warning' },
  APPROVED: { label: '已发布', tone: 'bg-success/10 text-success' },
  REJECTED: { label: '已拒绝', tone: 'bg-danger/10 text-danger' },
  ARCHIVED: { label: '已归档', tone: 'bg-muted text-fg-subtle' },
};

export default function EmployeeDetailPage({ params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = use(paramsPromise);
  const router = useRouter();
  const queryClient = useQueryClient();
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [showApproveDialog, setShowApproveDialog] = useState(false);
  const [removeBindingDialog, setRemoveBindingDialog] = useState<{ open: boolean; bindingId: string; bindingName: string }>({
    open: false, bindingId: '', bindingName: '',
  });

  const { data: employee, isLoading } = useQuery({
    queryKey: ['admin-employee', params.id],
    queryFn: async () => {
      const res = await api.get<{ data: any[] }>(`/admin/employees`);
      const all = res.data || [];
      return all.find((e: any) => e.id === params.id);
    },
  });

  const { data: bindings, isLoading: bindingsLoading } = useEmployeeBindings(params.id);
  const removeBindingMutation = useRemoveBinding();

  const approveMutation = useMutation({
    mutationFn: async (note?: string) => {
      return api.post(`/admin/employees/${params.id}/approve`, { note });
    },
    onSuccess: () => {
      toast.success('审核通过');
      queryClient.invalidateQueries({ queryKey: ['admin-employee', params.id] });
      queryClient.invalidateQueries({ queryKey: ['admin-employees'] });
      router.push('/admin/employees');
    },
    onError: (error: any) => {
      toast.error(`审核失败: ${error.response?.data?.message || error.message}`);
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async (reason: string) => {
      return api.post(`/admin/employees/${params.id}/reject`, { reason });
    },
    onSuccess: () => {
      toast.success('已拒绝');
      queryClient.invalidateQueries({ queryKey: ['admin-employee', params.id] });
      queryClient.invalidateQueries({ queryKey: ['admin-employees'] });
      setShowRejectDialog(false);
      router.push('/admin/employees');
    },
    onError: (error: any) => {
      toast.error(`拒绝失败: ${error.response?.data?.message || error.message}`);
    },
  });

  const handleApprove = () => {
    setShowApproveDialog(true);
  };

  const handleApproveConfirm = () => {
    approveMutation.mutate(undefined);
  };

  const handleReject = () => {
    if (!rejectReason.trim()) {
      toast.error('请输入拒绝原因');
      return;
    }
    rejectMutation.mutate(rejectReason);
  };

  const handleRemoveBinding = () => {
    removeBindingMutation.mutate(removeBindingDialog.bindingId, {
      onSuccess: () => {
        toast.success('绑定已删除');
      },
      onError: (error: any) => {
        toast.error(error.message || '删除失败');
      },
    });
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!employee) {
    return (
      <div className="p-6">
        <p className="text-fg-muted">员工不存在</p>
      </div>
    );
  }

  const isPending = employee.status === 'PENDING';

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => router.push('/admin/employees')}>
          <ArrowLeft className="h-4 w-4" />
          返回
        </Button>
        <h1 className="text-2xl font-bold">员工详情</h1>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>基本信息</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                <Avatar name={employee.name} className="h-16 w-16" />
                <div>
                  <h2 className="text-xl font-semibold">{employee.name}</h2>
                  <p className="text-sm text-fg-muted">
                    {employee.industry} / {employee.position}
                  </p>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-fg-muted">描述</label>
                <p className="mt-1 text-sm">{employee.description}</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-fg-muted">状态</label>
                  <div className="mt-1">
                    <Badge className={STATUS_META[employee.status]?.tone}>
                      {STATUS_META[employee.status]?.label}
                    </Badge>
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium text-fg-muted">版本</label>
                  <p className="mt-1 text-sm">{employee.version}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-fg-muted">年费</label>
                  <p className="mt-1 text-sm font-medium">
                    {employee.annualPriceCNY && Number(employee.annualPriceCNY) > 0
                      ? `¥${Number(employee.annualPriceCNY).toLocaleString()}`
                      : '免费'}
                  </p>
                </div>
                <div>
                  <label className="text-sm font-medium text-fg-muted">
                    订阅赠送算力
                  </label>
                  <p className="mt-1 text-sm">
                    {employee.includedComputeCNY === null ? (
                      <span className="text-fg-muted">
                        未配置，订阅时取系统默认值
                      </span>
                    ) : (
                      `¥${Number(employee.includedComputeCNY).toLocaleString()}`
                    )}
                  </p>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-fg-muted">System Prompt</label>
                <pre className="mt-1 text-xs bg-muted p-3 rounded overflow-x-auto">
                  {employee.systemPrompt}
                </pre>
              </div>

              <div>
                <label className="text-sm font-medium text-fg-muted">模型</label>
                <p className="mt-1 text-sm">{employee.modelId}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>绑定能力</CardTitle>
            </CardHeader>
            <CardContent>
              {!employee.bindings || employee.bindings.length === 0 ? (
                <p className="text-sm text-fg-subtle">尚未绑定任何能力</p>
              ) : (
                <div className="space-y-2">
                  {employee.bindings.map((binding: any) => (
                    <div
                      key={binding.id}
                      className="flex items-center gap-2 p-2 rounded border border-border"
                    >
                      <span className="text-sm font-medium">{binding.capability.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>能力绑定详情</CardTitle>
              <div className="flex items-center gap-2">
                <Badge className="bg-secondary text-secondary-foreground">{bindings?.length || 0} 个</Badge>
                <Link href={`/admin/employees/${params.id}/bindings`}>
                  <Button variant="secondary" size="sm">
                    高级管理
                  </Button>
                </Link>
              </div>
            </CardHeader>
            <CardContent>
              {bindingsLoading ? (
                <div className="text-center py-8">
                  <Skeleton className="h-20 w-full" />
                </div>
              ) : !bindings || bindings.length === 0 ? (
                <div className="text-center py-8 text-fg-muted">
                  <p>暂无绑定的能力</p>
                  <Link href={`/admin/employees/${params.id}/edit`}>
                    <Button variant="link" size="sm" className="mt-2">
                      前往编辑
                    </Button>
                  </Link>
                </div>
              ) : (
                <div className="space-y-3">
                  {bindings.map((binding: any) => (
                    <div
                      key={binding.id}
                      className="flex items-start justify-between p-4 border rounded-lg"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <p className="font-medium">{binding.capability.name}</p>
                          <Badge className={binding.enabled ? 'border border-gsuccess/25 bg-gsuccess/12 text-gsuccess' : 'border border-glassline bg-glass-2 text-gtext-muted'}>
                            {binding.enabled ? '已启用' : '已禁用'}
                          </Badge>
                          <Badge className="border border-border">{binding.capability.type}</Badge>
                        </div>
                        <p className="text-sm text-fg-muted">
                          {binding.capability.description}
                        </p>
                        <p className="text-xs text-fg-subtle mt-2">
                          优先级: {binding.priority}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setRemoveBindingDialog({
                            open: true,
                            bindingId: binding.id,
                            bindingName: binding.capability.name,
                          });
                        }}
                        disabled={removeBindingMutation.isPending}
                      >
                        删除
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          {isPending && (
            <Card>
              <CardHeader>
                <CardTitle>审核操作</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button
                  className="w-full"
                  onClick={handleApprove}
                  disabled={approveMutation.isPending}
                >
                  <CheckCircle className="h-4 w-4 mr-2" />
                  {approveMutation.isPending ? '处理中...' : '审核通过'}
                </Button>
                <Button
                  variant="danger"
                  className="w-full"
                  onClick={() => setShowRejectDialog(true)}
                  disabled={rejectMutation.isPending}
                >
                  <XCircle className="h-4 w-4 mr-2" />
                  拒绝
                </Button>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>元数据</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div>
                <span className="text-fg-muted">创建时间：</span>
                <span>{new Date(employee.createdAt).toLocaleString('zh-CN')}</span>
              </div>
              <div>
                <span className="text-fg-muted">更新时间：</span>
                <span>{new Date(employee.updatedAt).toLocaleString('zh-CN')}</span>
              </div>
              {employee.publishedAt && (
                <div>
                  <span className="text-fg-muted">发布时间：</span>
                  <span>{new Date(employee.publishedAt).toLocaleString('zh-CN')}</span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {showRejectDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-xl">
            <h3 className="text-lg font-semibold">拒绝员工模板</h3>
            <p className="mt-2 text-sm text-fg-muted">请输入拒绝原因：</p>
            <textarea
              className="mt-3 w-full rounded border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              rows={4}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="请详细说明拒绝原因..."
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setShowRejectDialog(false);
                  setRejectReason('');
                }}
              >
                取消
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={handleReject}
                disabled={rejectMutation.isPending || !rejectReason.trim()}
              >
                {rejectMutation.isPending ? '处理中...' : '确认拒绝'}
              </Button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={showApproveDialog}
        onOpenChange={setShowApproveDialog}
        title="审核通过"
        description={`确认审核通过员工模板「${employee?.name}」吗？通过后该员工将发布到市场。`}
        confirmText="确认通过"
        cancelText="取消"
        variant="default"
        loading={approveMutation.isPending}
        onConfirm={handleApproveConfirm}
      />

      <ConfirmDialog
        open={removeBindingDialog.open}
        onOpenChange={(open) => setRemoveBindingDialog({ ...removeBindingDialog, open })}
        title="删除能力绑定"
        description={`确定要删除能力绑定「${removeBindingDialog.bindingName}」吗？此操作不可恢复。`}
        confirmText="确认删除"
        cancelText="取消"
        variant="danger"
        loading={removeBindingMutation.isPending}
        onConfirm={handleRemoveBinding}
      />
    </div>
  );
}
