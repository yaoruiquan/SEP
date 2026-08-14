'use client';

import { useState } from 'react';
import {
  Shield, Check, X, Clock, AlertCircle, Users, Building2, Plus, Trash2,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { toast } from '@/components/ui/toast';
import { useMembers, useDepartments } from '@/features/enterprise/use-enterprise';
import { useSubscriptions } from '@/features/subscription/use-subscriptions';
import {
  usePendingAccessRequests,
  useApproveAccessRequest,
  useRejectAccessRequest,
  useCreateGrant,
  useDeleteGrant,
  useEmployeeGrants,
  useAllSubscriptionGrants,
  type GrantRecord,
} from '@/features/permissions/use-permissions';
import type { Subscription, EnterpriseMember, Department } from '@/lib/types';
import { api } from '@/lib/api-client';

/**
 * 权限管理页
 * 路由：/permissions
 * 功能：成员授权矩阵 + 部门授权矩阵 + 申请审批
 */
export default function PermissionsPage() {
  const [viewMode, setViewMode] = useState<'employee' | 'department'>('employee');

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
            管理成员和部门对员工的使用权限，审批跨部门申请
          </p>
        </div>
        <Badge className="bg-primary/10 text-primary border border-primary/20">
          企业管理员
        </Badge>
      </div>

      {/* 视图切换 + 矩阵 */}
      <Card className="p-4">
        <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as 'employee' | 'department')}>
          <TabsList>
            <TabsTrigger value="employee">
              <Users className="w-4 h-4 mr-2" />
              按成员授权
            </TabsTrigger>
            <TabsTrigger value="department">
              <Building2 className="w-4 h-4 mr-2" />
              按部门授权
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

// ─────────────────────────────────────────────────────────
// 按部门授权（雇佣关系 × 部门 矩阵）
// ─────────────────────────────────────────────────────────

function DepartmentPermissionMatrix() {
  const { data: departments = [], isLoading: deptsLoading } = useDepartments();
  const { data: allSubs = [], isLoading: subsLoading } = useSubscriptions();
  const createGrant = useCreateGrant();
  const deleteGrant = useDeleteGrant();

  // 已解聘的不该出现在授权矩阵里 —— 点了也只会被后端拒
  const subs = allSubs.filter((s) => s.status !== 'EXPIRED');

  // 并行获取所有雇佣关系的 grants
  const grantsResults = useAllSubscriptionGrants(subs.map((s) => s.id));

  // subscriptionId → GrantRecord[]
  const subGrants = new Map<string, GrantRecord[]>();
  subs.forEach((sub, idx) => {
    subGrants.set(sub.id, grantsResults[idx]?.data ?? []);
  });

  const isLoading = deptsLoading || subsLoading;
  const isBusy = createGrant.isPending || deleteGrant.isPending;

  const toggleDeptGrant = async (subscriptionId: string, deptId: string) => {
    const grants = subGrants.get(subscriptionId) ?? [];
    const existing = grants.find((g) => g.department?.id === deptId && !g.expired);
    try {
      if (existing) {
        await deleteGrant.mutateAsync({ grantId: existing.id, subscriptionId });
        toast.success('已撤销部门授权');
      } else {
        await createGrant.mutateAsync({ subscriptionId, departmentId: deptId });
        toast.success('已授权该部门');
      }
    } catch {
      toast.error('操作失败，请重试');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-neutral-500">
        加载中...
      </div>
    );
  }

  if (departments.length === 0) {
    return (
      <div className="text-center py-12 text-neutral-500">
        暂无部门，请先前往「成员管理」创建部门
      </div>
    );
  }

  if (subs.length === 0) {
    return (
      <div className="text-center py-12 text-neutral-500">
        暂无硅基员工，请先在「雇佣关系」雇佣
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {departments.map((dept) => {
        // 统计该部门被授权了多少位硅基员工
        const grantedCount = subs.filter((sub) => {
          const grants = subGrants.get(sub.id) ?? [];
          return grants.some((g) => g.department?.id === dept.id && !g.expired);
        }).length;

        return (
          <Card key={dept.id} className="p-6">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Building2 className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold text-neutral-900">{dept.name}</h3>
                  <p className="text-sm text-neutral-500">
                    {dept._count?.members ?? 0} 名成员
                  </p>
                </div>
              </div>
              <Badge className="bg-success/10 text-success border border-success/20">
                {grantedCount} / {subs.length} 个员工已授权
              </Badge>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {subs.map((sub) => {
                const grants = subGrants.get(sub.id) ?? [];
                const grant = grants.find((g) => g.department?.id === dept.id);
                const hasActive = !!grant && !grant.expired;
                const hasExpired = !!grant && grant.expired;

                return (
                  <button
                    key={sub.id}
                    onClick={() => !isBusy && toggleDeptGrant(sub.id, dept.id)}
                    disabled={isBusy}
                    className={[
                      'p-3 rounded-lg border-2 transition-all text-left',
                      hasActive
                        ? 'border-success bg-success/5 hover:bg-success/10'
                        : hasExpired
                        ? 'border-neutral-200 bg-neutral-50 opacity-60 cursor-default'
                        : 'border-neutral-200 hover:border-primary/40 bg-white',
                      isBusy ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
                    ].join(' ')}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm font-medium text-neutral-900 truncate pr-1">
                        {sub.name}
                      </span>
                      {hasActive ? (
                        <Check className="w-4 h-4 text-success flex-shrink-0" />
                      ) : (
                        <div className="w-4 h-4 rounded border-2 border-neutral-300 flex-shrink-0" />
                      )}
                    </div>
                    {/* 雇佣关系不再挂部门（部门就是这张矩阵的另一维），改为展示岗位 */}
                    <p className="text-xs text-neutral-500 truncate">
                      {sub.employee.position}
                    </p>
                    {hasExpired && (
                      <span className="text-xs text-warning mt-1 block">授权已过期</span>
                    )}
                  </button>
                );
              })}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 按成员授权（每个硅基员工一张卡片）
// ─────────────────────────────────────────────────────────

function EmployeePermissionMatrix() {
  const { data: allSubs = [], isLoading: subsLoading } = useSubscriptions();
  const { data: members = [], isLoading: membersLoading } = useMembers();

  if (subsLoading || membersLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-neutral-500">
        加载中...
      </div>
    );
  }

  // 已解聘的不该出现在授权矩阵里 —— 点了也只会被后端拒
  const subs = allSubs.filter((s) => s.status !== 'EXPIRED');

  if (subs.length === 0) {
    return (
      <div className="text-center py-12 text-neutral-500">
        暂无硅基员工，请先在「雇佣关系」雇佣
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {subs.map((sub) => (
        <SubscriptionPermissionCard
          key={sub.id}
          subscription={sub}
          members={members}
        />
      ))}
    </div>
  );
}

/** 单段雇佣关系的授权卡片，独立管理自己的 grants 查询 */
function SubscriptionPermissionCard({
  subscription,
  members,
}: {
  subscription: Subscription;
  members: EnterpriseMember[];
}) {
  const { data: grants = [], isLoading } = useEmployeeGrants(subscription.id);
  const createGrant = useCreateGrant();
  const deleteGrant = useDeleteGrant();

  const activeGrants = grants.filter((g) => !g.expired);

  const toggleMember = async (memberId: string) => {
    const existing = grants.find((g) => g.member?.id === memberId && !g.expired);
    try {
      if (existing) {
        await deleteGrant.mutateAsync({ grantId: existing.id, subscriptionId: subscription.id });
        toast.success('已撤销授权');
      } else {
        await createGrant.mutateAsync({ subscriptionId: subscription.id, memberId });
        toast.success('已授权');
      }
    } catch {
      toast.error('操作失败，请重试');
    }
  };

  return (
    <Card className="p-6">
      {/* 雇佣关系信息头 */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <Avatar
            name={subscription.name}
            src={subscription.employee.avatar ?? null}
            className="w-11 h-11"
          />
          <div>
            <h3 className="font-semibold text-neutral-900">{subscription.name}</h3>
            {/* 部门是这张矩阵的另一维，雇佣关系本身不挂部门，这里展示岗位 */}
            <p className="text-sm text-neutral-500">{subscription.employee.position}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isLoading ? (
            <span className="text-sm text-neutral-400">加载中...</span>
          ) : (
            <Badge className="bg-success/10 text-success border border-success/20">
              {activeGrants.length} 项授权
            </Badge>
          )}
        </div>
      </div>

      {/* 成员授权网格 */}
      {members.length === 0 ? (
        <p className="text-sm text-neutral-400 py-4 text-center">暂无成员</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {members.map((member) => {
            const grant = grants.find((g) => g.member?.id === member.id);
            const hasActive = !!grant && !grant.expired;
            const hasExpired = !!grant && grant.expired;
            const isBusy = createGrant.isPending || deleteGrant.isPending;

            return (
              <button
                key={member.id}
                onClick={() => !isBusy && toggleMember(member.id)}
                disabled={isBusy}
                className={[
                  'p-3 rounded-lg border-2 transition-all text-left relative',
                  hasActive
                    ? 'border-success bg-success/5 hover:bg-success/10'
                    : hasExpired
                    ? 'border-neutral-200 bg-neutral-50 opacity-60 cursor-default'
                    : 'border-neutral-200 hover:border-primary/40 bg-white',
                  isBusy ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
                ].join(' ')}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-medium text-neutral-900 truncate pr-1">
                    {member.user.name ?? member.user.email}
                  </span>
                  {hasActive ? (
                    <Check className="w-4 h-4 text-success flex-shrink-0" />
                  ) : hasExpired ? (
                    <Clock className="w-4 h-4 text-neutral-400 flex-shrink-0" />
                  ) : (
                    <div className="w-4 h-4 rounded border-2 border-neutral-300 flex-shrink-0" />
                  )}
                </div>
                <p className="text-xs text-neutral-500 truncate">
                  {member.department?.name ?? '未分配部门'}
                </p>
                {hasExpired && (
                  <span className="text-xs text-warning mt-1 block">已过期</span>
                )}
                {hasActive && grant?.expiresAt && (
                  <span className="text-xs text-neutral-400 mt-1 block">
                    {new Date(grant.expiresAt) < new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
                      ? '⚠️ 即将到期'
                      : `至 ${new Date(grant.expiresAt).toLocaleDateString('zh-CN')}`}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────
// 待审批申请
// ─────────────────────────────────────────────────────────

function PendingApprovals() {
  const { data: requests = [], isLoading } = usePendingAccessRequests();
  const approveRequest = useApproveAccessRequest();
  const rejectRequest = useRejectAccessRequest();

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [selectedAction, setSelectedAction] = useState<'approve' | 'reject' | null>(null);
  const [selectedRequestId, setSelectedRequestId] = useState('');

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
    } catch {
      toast.error('操作失败，请重试');
    } finally {
      setSelectedAction(null);
      setSelectedRequestId('');
      setConfirmOpen(false);
    }
  };

  // 没有待审批时不显示此区块
  if (!isLoading && requests.length === 0) return null;

  return (
    <Card className="p-6">
      <div className="flex items-center gap-2 mb-5">
        <AlertCircle className="w-5 h-5 text-warning" />
        <h2 className="text-lg font-semibold text-neutral-900">待审批申请</h2>
        {!isLoading && (
          <Badge className="bg-warning/10 text-warning border border-warning/20">
            {requests.length} 条
          </Badge>
        )}
      </div>

      {isLoading ? (
        <div className="text-center py-8 text-neutral-500">加载中...</div>
      ) : (
        <div className="space-y-4">
          {requests.map((req) => (
            <div
              key={req.id}
              className="p-4 bg-neutral-50 rounded-lg border border-neutral-200"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-2">
                    <Avatar
                      name={req.requester.user.name}
                      src={req.requester.user.avatar}
                      className="w-9 h-9 flex-shrink-0"
                    />
                    <div className="min-w-0">
                      <p className="font-medium text-neutral-900">
                        {req.requester.user.name}
                        <span className="text-neutral-500 font-normal"> 申请使用 </span>
                        <span className="text-primary">{req.subscription.employee.name}</span>
                      </p>
                      <p className="text-xs text-neutral-500">
                        {req.requester.department?.name ?? '未分配部门'}
                        {' · 跨部门申请'}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-1.5 text-sm pl-12">
                    {req.reason && (
                      <p className="text-neutral-700">
                        <span className="text-neutral-500">申请理由：</span>
                        {req.reason}
                      </p>
                    )}
                    <div className="flex items-center gap-4 text-neutral-500">
                      {req.requestedDays && (
                        <span className="flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5" />
                          申请 {req.requestedDays} 天
                        </span>
                      )}
                      <span>
                        {new Date(req.createdAt).toLocaleString('zh-CN', {
                          month: 'numeric',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex gap-2 flex-shrink-0">
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
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={selectedAction === 'approve' ? '确认批准申请' : '确认拒绝申请'}
        description={
          selectedAction === 'approve'
            ? '批准后将自动授予限时权限，到期后自动回收。'
            : '拒绝后申请人将收到通知，可以重新提交申请。'
        }
        confirmText={selectedAction === 'approve' ? '确认批准' : '确认拒绝'}
        variant={selectedAction === 'reject' ? 'danger' : 'default'}
        onConfirm={confirmAction}
      />
    </Card>
  );
}
