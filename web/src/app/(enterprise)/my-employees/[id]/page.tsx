'use client';

import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Settings, Trash2, Activity, Clock, FileText, Sliders, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Avatar } from '@/components/ui/avatar';
import { StatusDot } from '@/components/ui/status-dot';
import { ProgressBar } from '@/components/ui/progress-bar';
import { CenteredSpinner, EmptyState } from '@/components/ui/feedback';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useState } from 'react';
import { useEmployeeDetail, useUpdateEmployee, useDeleteEmployee } from '@/features/employee/use-employee-detail';
import { useWebSocket } from '@/hooks/use-websocket';
import { useAuthStore } from '@/lib/auth-store';

/**
 * 员工详情页
 * 路由：/my-employees/[id]
 */
export default function EmployeeDetailPage() {
  const params = useParams();
  const router = useRouter();
  const employeeId = params.id as string;
  const { token } = useAuthStore();

  const [activeTab, setActiveTab] = useState('overview');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  // 获取员工详情
  const { data: employee, isLoading, isError, error } = useEmployeeDetail(employeeId);

  // WebSocket 实时状态（只在有 token 和 employeeId 时连接）
  const wsUrl = token && employeeId
    ? `${process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001'}/employees/${employeeId}/status?token=${token}`
    : '';

  const { isConnected: wsConnected } = useWebSocket(wsUrl, {
    onMessage: (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'status_update') {
          // TODO: 更新本地状态
          console.log('Employee status updated:', data);
        }
      } catch (err) {
        console.error('WebSocket message parse error:', err);
      }
    },
  });

  // 更新 & 删除
  const updateEmployee = useUpdateEmployee();
  const deleteEmployee = useDeleteEmployee();

  const handleDelete = () => {
    deleteEmployee.mutate(employeeId, {
      onSuccess: () => {
        router.push('/my-employees');
      },
    });
  };

  if (isLoading) {
    return <CenteredSpinner label="加载员工详情..." />;
  }

  if (isError || !employee) {
    return (
      <div className="flex h-screen items-center justify-center">
        <EmptyState
          icon={<AlertTriangle className="h-8 w-8 text-danger" />}
          title="加载失败"
          description={error?.message || '无法获取员工详情'}
          action={
            <Button variant="outline" onClick={() => router.back()}>
              返回
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* 顶部导航 */}
      <div className="sticky top-0 z-10 bg-white border-b border-neutral-200">
        <div className="px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.back()}
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                返回
              </Button>
              <div className="h-6 w-px bg-neutral-200" />
              <h1 className="text-xl font-semibold text-neutral-900">员工详情</h1>
              {wsConnected && (
                <Badge className="ml-2 text-xs text-success border-success">
                  ● 实时连接
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsEditing(!isEditing)}
              >
                <Settings className="w-4 h-4 mr-2" />
                {isEditing ? '取消编辑' : '编辑'}
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                删除
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="p-6">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* 左侧：员工信息卡片 */}
          <div className="lg:col-span-1">
            <Card className="p-6 space-y-6 sticky top-24">
              {/* 头像和基本信息 */}
              <div className="flex flex-col items-center text-center">
                <div className="relative">
                  <Avatar
                    name={employee.name}
                    src={employee.avatar}
                    className="w-24 h-24 text-2xl"
                  />
                  <div className="absolute -bottom-1 -right-1">
                    <StatusDot status={employee.status} size="lg" />
                  </div>
                </div>
                <h2 className="mt-4 text-lg font-semibold text-neutral-900">
                  {employee.name}
                </h2>
                <p className="text-sm text-neutral-600 mt-1">
                  {employee.templateName || '自定义员工'} {employee.templateVersion && `· v${employee.templateVersion}`}
                </p>
                <StatusDot
                  status={employee.status}
                  showLabel
                  className="mt-3"
                />
              </div>

              {/* 统计数据 */}
              <div className="space-y-3 pt-4 border-t border-neutral-200">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-neutral-600">部门</span>
                  <Badge>{employee.departmentName || '未分配'}</Badge>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-neutral-600">总任务数</span>
                  <span className="font-semibold text-neutral-900">
                    {employee.stats?.totalTasks || 0}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-neutral-600">成功率</span>
                  <span className="font-semibold text-success">
                    {employee.stats?.successRate || 0}%
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-neutral-600">平均响应</span>
                  <span className="font-semibold text-neutral-900">
                    {employee.stats?.avgResponseTime || 0}s
                  </span>
                </div>
              </div>

              {/* 本月统计 */}
              <div className="space-y-3 pt-4 border-t border-neutral-200">
                <h3 className="text-sm font-medium text-neutral-700">本月统计</h3>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-neutral-600">调用次数</span>
                    <span className="font-semibold">{employee.stats?.monthCalls || 0}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-neutral-600">消费金额</span>
                    <span className="font-semibold">¥{employee.stats?.monthSpend || 0}</span>
                  </div>
                </div>
              </div>

              {/* 快捷操作 */}
              <div className="pt-4 border-t border-neutral-200 space-y-2">
                <Button variant="primary" className="w-full">
                  <Activity className="w-4 h-4 mr-2" />
                  执行任务
                </Button>
                <Button variant="outline" className="w-full">
                  <FileText className="w-4 h-4 mr-2" />
                  查看文档
                </Button>
              </div>
            </Card>
          </div>

          {/* 右侧：Tab 内容区 */}
          <div className="lg:col-span-3">
            <Card className="p-6">
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList>
                  <TabsTrigger value="overview">
                    <Activity className="w-4 h-4 mr-2" />
                    概览
                  </TabsTrigger>
                  <TabsTrigger value="tasks">
                    <Clock className="w-4 h-4 mr-2" />
                    任务
                  </TabsTrigger>
                  <TabsTrigger value="config">
                    <Sliders className="w-4 h-4 mr-2" />
                    配置
                  </TabsTrigger>
                  <TabsTrigger value="logs">
                    <FileText className="w-4 h-4 mr-2" />
                    日志
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="mt-6">
                  <OverviewTab employee={employee} />
                </TabsContent>
                <TabsContent value="tasks" className="mt-6">
                  <TasksTab />
                </TabsContent>
                <TabsContent value="config" className="mt-6">
                  <ConfigTab employee={employee} />
                </TabsContent>
                <TabsContent value="logs" className="mt-6">
                  <LogsTab />
                </TabsContent>
              </Tabs>
            </Card>
          </div>
        </div>
      </div>

      {/* 删除确认对话框 */}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="删除员工"
        description={`确定要删除员工「${employee.name}」吗？此操作不可撤销，员工的所有数据和历史记录都将被删除。`}
        confirmText="删除"
        variant="danger"
        loading={deleteEmployee.isPending}
        onConfirm={handleDelete}
      />
    </div>
  );
}

// ============ Tab 组件 ============

function OverviewTab({ employee }: { employee: any }) {
  return (
    <div className="space-y-6">
      {/* 员工简介 */}
      <div>
        <h3 className="text-base font-semibold text-neutral-900 mb-3">员工简介</h3>
        <p className="text-sm text-neutral-700 leading-relaxed">
          {employee.description || '暂无描述'}
        </p>
      </div>

      {/* 核心能力 */}
      <div>
        <h3 className="text-base font-semibold text-neutral-900 mb-3">核心能力</h3>
        {employee.capabilities.length === 0 ? (
          <p className="text-sm text-neutral-500">暂未绑定能力</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {employee.capabilities.map((cap: any) => (
              <Badge key={cap.id} className="bg-primary/10 text-primary border border-primary/20">
                {cap.name}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* 基本信息 */}
      <div>
        <h3 className="text-base font-semibold text-neutral-900 mb-3">基本信息</h3>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-neutral-600">行业：</span>
            <span className="font-medium">{employee.industry.join('、') || '未设置'}</span>
          </div>
          <div>
            <span className="text-neutral-600">岗位：</span>
            <span className="font-medium">{employee.position.join('、') || '未设置'}</span>
          </div>
          <div>
            <span className="text-neutral-600">创建时间：</span>
            <span className="font-medium">{new Date(employee.createdAt).toLocaleDateString()}</span>
          </div>
          <div>
            <span className="text-neutral-600">最后更新：</span>
            <span className="font-medium">{new Date(employee.updatedAt).toLocaleDateString()}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function TasksTab() {
  // Mock 任务历史
  const tasks = [
    { id: '1', name: '客户咨询-订单状态', status: 'completed', time: '2024-01-20 14:30' },
    { id: '2', name: '售后处理-退款申请', status: 'completed', time: '2024-01-20 13:15' },
    { id: '3', name: '产品推荐-手机配件', status: 'failed', time: '2024-01-20 11:45' },
  ];

  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold text-neutral-900">任务历史</h3>
      <div className="space-y-3">
        {tasks.map((task) => (
          <div
            key={task.id}
            className="p-4 bg-neutral-50 rounded-lg border border-neutral-200 hover:border-neutral-300 transition-colors"
          >
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <p className="font-medium text-neutral-900">{task.name}</p>
                <p className="text-sm text-neutral-600 mt-1">{task.time}</p>
              </div>
              <Badge
                className={
                  task.status === 'completed'
                    ? 'bg-success/10 text-success'
                    : 'bg-danger/10 text-danger'
                }
              >
                {task.status === 'completed' ? '已完成' : '失败'}
              </Badge>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ConfigTab({ employee }: { employee: any }) {
  const [formData, setFormData] = useState({
    name: employee.name,
    departmentId: employee.departmentId || '',
    description: employee.description || '',
  });
  const updateEmployee = useUpdateEmployee();

  const handleSave = () => {
    updateEmployee.mutate({
      id: employee.id,
      name: formData.name,
      departmentId: formData.departmentId || null,
      description: formData.description,
    });
  };

  return (
    <div className="space-y-6">
      <h3 className="text-base font-semibold text-neutral-900">基本信息</h3>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-2">
            员工名称
          </label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-2">
            所属部门
          </label>
          <input
            type="text"
            value={employee.departmentName || '未分配'}
            disabled
            className="w-full px-3 py-2 border border-neutral-300 rounded-lg bg-neutral-50 text-neutral-500"
          />
          <p className="text-xs text-neutral-500 mt-1">部门分配需在组织管理中设置</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-2">
            员工描述
          </label>
          <textarea
            rows={4}
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary"
          />
        </div>
        <div className="flex justify-end gap-3 pt-4">
          <Button
            variant="outline"
            onClick={() => setFormData({
              name: employee.name,
              departmentId: employee.departmentId || '',
              description: employee.description || '',
            })}
          >
            重置
          </Button>
          <Button
            variant="primary"
            onClick={handleSave}
            disabled={updateEmployee.isPending}
          >
            {updateEmployee.isPending ? '保存中...' : '保存更改'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function LogsTab() {
  const logs = [
    { time: '2024-01-20 14:35:22', action: '任务完成', detail: '客户咨询-订单状态' },
    { time: '2024-01-20 14:30:15', action: '任务开始', detail: '客户咨询-订单状态' },
    { time: '2024-01-20 13:20:45', action: '任务完成', detail: '售后处理-退款申请' },
  ];

  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold text-neutral-900">操作日志</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200">
              <th className="text-left py-3 px-4 font-medium text-neutral-700">时间</th>
              <th className="text-left py-3 px-4 font-medium text-neutral-700">操作</th>
              <th className="text-left py-3 px-4 font-medium text-neutral-700">详情</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log, idx) => (
              <tr key={idx} className="border-b border-neutral-100 hover:bg-neutral-50">
                <td className="py-3 px-4 text-neutral-600">{log.time}</td>
                <td className="py-3 px-4">
                  <Badge>{log.action}</Badge>
                </td>
                <td className="py-3 px-4 text-neutral-900">{log.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
