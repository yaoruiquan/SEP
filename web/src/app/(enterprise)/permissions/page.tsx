'use client';

import { useState } from 'react';
import { Shield, Check, X, Clock, AlertCircle, Users, Building2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { toast } from '@/components/ui/toast';
import { useInstances, useMembers } from '@/features/enterprise/use-enterprise';
import {
  usePendingAccessRequests,
  useApproveAccessRequest,
  useRejectAccessRequest,
  useCreateGrant,
  useDeleteGrant,
  useEmployeeGrants,
} from '@/features/permissions/use-permissions';

/**
 * 权限管理页
 * 路由：/permissions
 * 功能：权限矩阵表格 + 跨部门申请审批
 */
export default function PermissionsPage() {
  const [viewMode, setViewMode] = useState<'department' | 'employee'>('employee');

  return (
    <div className="min-h-screen bg-neutral-50 p-6 space-y-6">
      {/* 页头 */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 flex items-center gap-2">
            <Shield className="w-6 h-6 text-primary" />
            权限管理
          </h1>
          <p className="text-sm text-neutral-600 mt-1">
            管理成员对员工的使用权限，审批跨部门申请
          </p>
        </div>
        <Badge className="bg-primary/10 text-primary border border-primary/20">
          企业管理员
        </Badge>
      </div>

      {/* 视图切换 */}
      <Card className="p-4">
        <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as any)}>
          <TabsList>
            <TabsTrigger value="employee">
              <Users className="w-4 h-4 mr-2" />
              按员工查看
            </TabsTrigger>
            <TabsTrigger value="department">
              <Building2 className="w-4 h-4 mr-2" />
              按部门查看
            </TabsTrigger>
          </TabsList>

          <TabsContent value="employee" className="mt-6">
            <EmployeePermissionMatrix />
          </TabsContent>

          <TabsContent value="department" className="mt-6">
            <DepartmentPermissionMatrix />
          </TabsContent>
        </Tabs>
      </Card>

      {/* 待审批申请 */}
      <PendingApprovals />
    </div>
  );
}

// ============ 按员工查看 ============

function EmployeePermissionMatrix() {
  const { data: instances = [], isLoading: instancesLoading } = useInstances();
  const { data: members = [], isLoading: membersLoading } = useMembers();
  const [selectedInstance, setSelectedInstance] = useState<string>('');

  const createGrant = useCreateGrant();
  const deleteGrant = useDeleteGrant();

  // 选择第一个实例作为默认值
  const currentInstance = selectedInstance || instances[0]?.id;
  const { data: grants = [] } = useEmployeeGrants(currentInstance || '');

  // 构造授权映射 (memberId -> grantId)
  const grantMap = new Map<string, string>();
  grants.forEach((g) => {
    if (g.memberId) {
      grantMap.set(g.memberId, g.id);
    }
  });

  const togglePermission = async (instanceId: string, memberId: string) => {
    const grantId = grantMap.get(memberId);

    if (grantId) {
      // 撤销
      await deleteGrant.mutateAsync({ grantId, instanceId });
      toast.success('已撤销授权');
    } else {
      // 授权
      await createGrant.mutateAsync({ instanceId, memberId });
      toast.success('已授权');
    }
  };

  if (instancesLoading || membersLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-neutral-600">加载中...</div>
      </div>
    );
  }

  if (instances.length === 0) {
    return (
      <div className="text-center py-12 text-neutral-600">
        暂无员工实例，请先创建员工
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {instances.map((instance) => (
        <Card key={instance.id} className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Avatar name={instance.name} src={null} className="w-12 h-12" />
              <div>
                <h3 className="font-semibold text-neutral-900">{instance.name}</h3>
                <p className="text-sm text-neutral-600">
                  {instance.department?.name || '未分配部门'}
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {members.map((member) => {
              const hasPermission = grants.some((g) => g.memberId === member.id && g.instanceId === instance.id);
              const grantId = grants.find((g) => g.memberId === member.id && g.instanceId === instance.id)?.id;

              return (
                <button
                  key={member.id}
                  onClick={() => togglePermission(instance.id, member.id)}
                  disabled={createGrant.isPending || deleteGrant.isPending}
                  className={`p-3 rounded-lg border-2 transition-all text-left ${
                    hasPermission
                      ? 'border-success bg-success/5 hover:bg-success/10'
                      : 'border-neutral-200 hover:border-neutral-300 bg-white'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-neutral-900">
                      {member.user.name}
                    </span>
                    {hasPermission ? (
                      <Check className="w-4 h-4 text-success" />
                    ) : (
                      <div className="w-4 h-4 rounded border-2 border-neutral-300" />
                    )}
                  </div>
                  <p className="text-xs text-neutral-600">
                    {member.department?.name || '未分配部门'}
                  </p>
                </button>
              );
            })}
          </div>
        </Card>
      ))}
    </div>
  );
}

// ============ 按部门查看 ============

function DepartmentPermissionMatrix() {
  const departments = [
    { id: 'd1', name: '销售部', members: 5, employees: 2 },
    { id: 'd2', name: '客服部', members: 8, employees: 3 },
    { id: 'd3', name: '技术部', members: 12, employees: 4 },
  ];

  return (
    <div className="space-y-4">
      {departments.map((dept) => (
        <Card key={dept.id} className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold text-neutral-900 flex items-center gap-2">
                <Building2 className="w-5 h-5 text-primary" />
                {dept.name}
              </h3>
              <p className="text-sm text-neutral-600 mt-1">
                {dept.members} 名成员 · {dept.employees} 个员工
              </p>
            </div>
            <Button variant="outline" size="sm">
              部门权限设置
            </Button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
              <p className="text-sm text-blue-700 font-medium">全员可用</p>
              <p className="text-2xl font-bold text-blue-900 mt-1">2</p>
            </div>
            <div className="p-4 bg-green-50 rounded-lg border border-green-200">
              <p className="text-sm text-green-700 font-medium">部分授权</p>
              <p className="text-2xl font-bold text-green-900 mt-1">0</p>
            </div>
            <div className="p-4 bg-neutral-50 rounded-lg border border-neutral-200">
              <p className="text-sm text-neutral-700 font-medium">未授权</p>
              <p className="text-2xl font-bold text-neutral-900 mt-1">0</p>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

// ============ 待审批申请 ============

function PendingApprovals() {
  const { data: requests = [], isLoading } = usePendingAccessRequests();
  const approveRequest = useApproveAccessRequest();
  const rejectRequest = useRejectAccessRequest();

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [selectedAction, setSelectedAction] = useState<'approve' | 'reject' | null>(null);
  const [selectedRequestId, setSelectedRequestId] = useState<string>('');

  const handleAction = (action: 'approve' | 'reject', requestId: string) => {
    setSelectedAction(action);
    setSelectedRequestId(requestId);
    setConfirmOpen(true);
  };

  const confirmAction = async () => {
    try {
      if (selectedAction === 'approve') {
        await approveRequest.mutateAsync({ requestId: selectedRequestId });
        toast.success('已批准申请，授权已生效');
      } else {
        await rejectRequest.mutateAsync({ requestId: selectedRequestId });
        toast.success('已拒绝申请');
      }
    } catch (error) {
      toast.error('操作失败，请重试');
    } finally {
      setSelectedAction(null);
      setSelectedRequestId('');
      setConfirmOpen(false);
    }
  };

  if (isLoading) {
    return (
      <Card className="p-6">
        <div className="text-center text-neutral-600">加载中...</div>
      </Card>
    );
  }

  if (requests.length === 0) {
    return null;
  }

  return (
    <Card className="p-6">
      <div className="flex items-center gap-2 mb-4">
        <AlertCircle className="w-5 h-5 text-warning" />
        <h2 className="text-lg font-semibold text-neutral-900">
          待审批申请
        </h2>
        <Badge className="bg-warning/10 text-warning border border-warning/20">
          {requests.length} 条
        </Badge>
      </div>

      <div className="space-y-4">
        {requests.map((req) => (
          <div
            key={req.id}
            className="p-4 bg-neutral-50 rounded-lg border border-neutral-200"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <Avatar
                    name={req.requester.user.name}
                    src={req.requester.user.avatar}
                    className="w-10 h-10"
                  />
                  <div>
                    <p className="font-medium text-neutral-900">
                      {req.requester.user.name}
                      <span className="text-neutral-600 font-normal">
                        {' '}申请使用{' '}
                      </span>
                      {req.instance.employee.name}
                    </p>
                    <p className="text-xs text-neutral-600">
                      {req.requester.department?.name || '未分配部门'}
                      {req.requester.department?.name !== req.instance.employee.name && ' → 跨部门申请'}
                    </p>
                  </div>
                </div>

                <div className="space-y-2 text-sm">
                  {req.reason && (
                    <div className="flex items-start gap-2">
                      <span className="text-neutral-600 min-w-16">申请理由:</span>
                      <span className="text-neutral-900">{req.reason}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-4 text-neutral-600">
                    {req.requestedDays && (
                      <span className="flex items-center gap-1">
                        <Clock className="w-4 h-4" />
                        期限: {req.requestedDays} 天
                      </span>
                    )}
                    <span>
                      申请时间: {new Date(req.createdAt).toLocaleString('zh-CN')}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => handleAction('approve', req.id)}
                  disabled={approveRequest.isPending || rejectRequest.isPending}
                >
                  <Check className="w-4 h-4 mr-1" />
                  批准
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleAction('reject', req.id)}
                  disabled={approveRequest.isPending || rejectRequest.isPending}
                >
                  <X className="w-4 h-4 mr-1" />
                  拒绝
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={selectedAction === 'approve' ? '确认批准申请' : '确认拒绝申请'}
        description={
          selectedAction === 'approve'
            ? '批准后将自动授予限时权限，到期后自动回收。'
            : '拒绝后申请人将收到通知，可以重新提交申请。'
        }
        confirmText={selectedAction === 'approve' ? '批准' : '拒绝'}
        variant={selectedAction === 'reject' ? 'danger' : 'default'}
        onConfirm={confirmAction}
      />
    </Card>
  );
}
