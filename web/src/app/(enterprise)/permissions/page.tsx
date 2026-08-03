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
  // Mock 数据
  const employees = [
    { id: '1', name: '销售助理小李', avatar: null, department: '销售部' },
    { id: '2', name: '客服专员小王', avatar: null, department: '客服部' },
    { id: '3', name: '数据分析师小刘', avatar: null, department: '技术部' },
  ];

  const members = [
    { id: 'm1', name: '张三', department: '销售部', avatar: null },
    { id: 'm2', name: '李四', department: '客服部', avatar: null },
    { id: 'm3', name: '王五', department: '技术部', avatar: null },
    { id: 'm4', name: '赵六', department: '销售部', avatar: null },
  ];

  // Mock 权限数据 (employeeId -> memberId[])
  const [permissions, setPermissions] = useState<Record<string, string[]>>({
    '1': ['m1', 'm4'], // 小李: 张三、赵六
    '2': ['m2'], // 小王: 李四
    '3': ['m3'], // 小刘: 王五
  });

  const togglePermission = (employeeId: string, memberId: string) => {
    setPermissions((prev) => {
      const current = prev[employeeId] || [];
      const has = current.includes(memberId);

      if (has) {
        toast.success('已撤销授权');
        return { ...prev, [employeeId]: current.filter((id) => id !== memberId) };
      } else {
        toast.success('已授权');
        return { ...prev, [employeeId]: [...current, memberId] };
      }
    });
  };

  return (
    <div className="space-y-4">
      {employees.map((employee) => (
        <Card key={employee.id} className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Avatar name={employee.name} src={employee.avatar} className="w-12 h-12" />
              <div>
                <h3 className="font-semibold text-neutral-900">{employee.name}</h3>
                <p className="text-sm text-neutral-600">{employee.department}</p>
              </div>
            </div>
            <Button variant="outline" size="sm">
              批量设置
            </Button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {members.map((member) => {
              const hasPermission = permissions[employee.id]?.includes(member.id);
              return (
                <button
                  key={member.id}
                  onClick={() => togglePermission(employee.id, member.id)}
                  className={`p-3 rounded-lg border-2 transition-all text-left ${
                    hasPermission
                      ? 'border-success bg-success/5 hover:bg-success/10'
                      : 'border-neutral-200 hover:border-neutral-300 bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-neutral-900">
                      {member.name}
                    </span>
                    {hasPermission ? (
                      <Check className="w-4 h-4 text-success" />
                    ) : (
                      <div className="w-4 h-4 rounded border-2 border-neutral-300" />
                    )}
                  </div>
                  <p className="text-xs text-neutral-600">{member.department}</p>
                </button>
              );
            })}
          </div>

          <div className="mt-4 pt-4 border-t border-neutral-200 flex justify-end">
            <Button variant="outline" size="sm">
              高级权限配置
            </Button>
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
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [selectedAction, setSelectedAction] = useState<'approve' | 'reject' | null>(null);

  // Mock 申请数据
  const applications = [
    {
      id: 'app1',
      applicant: { name: '李四', avatar: null, department: '客服部' },
      employee: { name: '数据分析师小刘', avatar: null, department: '技术部' },
      reason: '需要分析 Q4 客户满意度数据，协助制定客服改进方案',
      duration: 7,
      appliedAt: '2024-01-15 14:30',
    },
    {
      id: 'app2',
      applicant: { name: '赵六', avatar: null, department: '销售部' },
      employee: { name: '客服专员小王', avatar: null, department: '客服部' },
      reason: '需要帮助处理重点客户售后问题',
      duration: 3,
      appliedAt: '2024-01-15 10:20',
    },
  ];

  const handleAction = (action: 'approve' | 'reject') => {
    setSelectedAction(action);
    setConfirmOpen(true);
  };

  const confirmAction = async () => {
    if (selectedAction === 'approve') {
      toast.success('已批准申请，授权已生效');
    } else {
      toast.success('已拒绝申请');
    }
    setSelectedAction(null);
  };

  if (applications.length === 0) {
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
          {applications.length} 条
        </Badge>
      </div>

      <div className="space-y-4">
        {applications.map((app) => (
          <div
            key={app.id}
            className="p-4 bg-neutral-50 rounded-lg border border-neutral-200"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <Avatar
                    name={app.applicant.name}
                    src={app.applicant.avatar}
                    className="w-10 h-10"
                  />
                  <div>
                    <p className="font-medium text-neutral-900">
                      {app.applicant.name}
                      <span className="text-neutral-600 font-normal">
                        {' '}申请使用{' '}
                      </span>
                      {app.employee.name}
                    </p>
                    <p className="text-xs text-neutral-600">
                      {app.applicant.department} → {app.employee.department}（跨部门）
                    </p>
                  </div>
                </div>

                <div className="space-y-2 text-sm">
                  <div className="flex items-start gap-2">
                    <span className="text-neutral-600 min-w-16">申请理由:</span>
                    <span className="text-neutral-900">{app.reason}</span>
                  </div>
                  <div className="flex items-center gap-4 text-neutral-600">
                    <span className="flex items-center gap-1">
                      <Clock className="w-4 h-4" />
                      期限: {app.duration} 天
                    </span>
                    <span>申请时间: {app.appliedAt}</span>
                  </div>
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => handleAction('approve')}
                >
                  <Check className="w-4 h-4 mr-1" />
                  批准
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleAction('reject')}
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
