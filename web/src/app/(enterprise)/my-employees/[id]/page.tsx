'use client';

import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Settings, Trash2, Activity, Clock, FileText, Sliders } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Avatar } from '@/components/ui/avatar';
import { StatusDot } from '@/components/ui/status-dot';
import { ProgressBar } from '@/components/ui/progress-bar';
import { CenteredSpinner } from '@/components/ui/feedback';
import { useState } from 'react';

/**
 * 员工详情页
 * 路由：/my-employees/[id]
 */
export default function EmployeeDetailPage() {
  const params = useParams();
  const router = useRouter();
  const employeeId = params.id as string;

  const [activeTab, setActiveTab] = useState('overview');

  // TODO: 从 API 获取员工详情
  const isLoading = false;

  if (isLoading) {
    return <CenteredSpinner label="加载员工详情..." />;
  }

  // Mock 数据
  const employee = {
    id: employeeId,
    name: 'AI助手小明',
    avatar: null,
    status: 'online' as const,
    templateName: '智能客服助手',
    version: '2.1.0',
    department: '客服部',
    createdAt: '2024-01-15',
    capabilities: ['问答', '订单查询', '售后处理'],
    description: '专注于客户咨询服务的智能助手，具备丰富的业务知识和友好的沟通方式。',
    stats: {
      totalTasks: 156,
      successRate: 98.5,
      avgResponseTime: 1.2,
      monthCalls: 1234,
      monthSpend: 156.78,
    },
  };

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
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm">
                <Settings className="w-4 h-4 mr-2" />
                编辑
              </Button>
              <Button variant="danger" size="sm">
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
                  {employee.templateName} · v{employee.version}
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
                  <Badge>{employee.department}</Badge>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-neutral-600">总任务数</span>
                  <span className="font-semibold text-neutral-900">
                    {employee.stats.totalTasks}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-neutral-600">成功率</span>
                  <span className="font-semibold text-success">
                    {employee.stats.successRate}%
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-neutral-600">平均响应</span>
                  <span className="font-semibold text-neutral-900">
                    {employee.stats.avgResponseTime}s
                  </span>
                </div>
              </div>

              {/* 本月统计 */}
              <div className="space-y-3 pt-4 border-t border-neutral-200">
                <h3 className="text-sm font-medium text-neutral-700">本月统计</h3>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-neutral-600">调用次数</span>
                    <span className="font-semibold">{employee.stats.monthCalls}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-neutral-600">消费金额</span>
                    <span className="font-semibold">¥{employee.stats.monthSpend}</span>
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
          {employee.description}
        </p>
      </div>

      {/* 核心能力 */}
      <div>
        <h3 className="text-base font-semibold text-neutral-900 mb-3">核心能力</h3>
        <div className="flex flex-wrap gap-2">
          {employee.capabilities.map((cap: string) => (
            <Badge key={cap} className="bg-primary/10 text-primary border border-primary/20">
              {cap}
            </Badge>
          ))}
        </div>
      </div>

      {/* 当前任务 */}
      <div>
        <h3 className="text-base font-semibold text-neutral-900 mb-3">当前任务</h3>
        <div className="space-y-3">
          <div className="p-4 bg-neutral-50 rounded-lg border border-neutral-200">
            <div className="flex items-start justify-between mb-2">
              <div>
                <p className="font-medium text-neutral-900">客户咨询处理</p>
                <p className="text-sm text-neutral-600 mt-1">
                  处理客户关于订单配送的咨询
                </p>
              </div>
              <Badge className="bg-success/10 text-success">进行中</Badge>
            </div>
            <ProgressBar value={65} variant="success" showLabel label="处理进度 65%" />
          </div>

          <div className="p-4 bg-neutral-50 rounded-lg border border-neutral-200">
            <div className="flex items-start justify-between mb-2">
              <div>
                <p className="font-medium text-neutral-900">售后问题跟进</p>
                <p className="text-sm text-neutral-600 mt-1">
                  跟进用户退换货请求
                </p>
              </div>
              <Badge className="bg-warning/10 text-warning">排队中</Badge>
            </div>
            <ProgressBar value={15} variant="default" showLabel label="等待处理" />
          </div>
        </div>
      </div>

      {/* 工作摘要 */}
      <div>
        <h3 className="text-base font-semibold text-neutral-900 mb-3">近7天工作摘要</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="p-4 bg-blue-50 border-blue-200">
            <p className="text-sm text-blue-700">总任务数</p>
            <p className="text-2xl font-bold text-blue-900 mt-1">89</p>
          </Card>
          <Card className="p-4 bg-green-50 border-green-200">
            <p className="text-sm text-green-700">成功完成</p>
            <p className="text-2xl font-bold text-green-900 mt-1">86</p>
          </Card>
          <Card className="p-4 bg-red-50 border-red-200">
            <p className="text-sm text-red-700">失败</p>
            <p className="text-2xl font-bold text-red-900 mt-1">2</p>
          </Card>
          <Card className="p-4 bg-yellow-50 border-yellow-200">
            <p className="text-sm text-yellow-700">等待中</p>
            <p className="text-2xl font-bold text-yellow-900 mt-1">1</p>
          </Card>
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
            defaultValue={employee.name}
            className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-2">
            所属部门
          </label>
          <input
            type="text"
            defaultValue={employee.department}
            className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-2">
            员工描述
          </label>
          <textarea
            rows={4}
            defaultValue={employee.description}
            className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary"
          />
        </div>
        <div className="flex justify-end gap-3 pt-4">
          <Button variant="outline">取消</Button>
          <Button variant="primary">保存更改</Button>
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
