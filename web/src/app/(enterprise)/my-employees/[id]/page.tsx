'use client';

import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Settings, Trash2, Activity, Clock, FileText, Sliders, AlertTriangle, Zap, BarChart2 } from 'lucide-react';
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
import { useMyEmployees } from '@/features/enterprise/use-enterprise';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';

/**
 * 员工详情页
 * 路由：/my-employees/[id]
 * 注意：id 是 subscriptionId（雇佣关系 id），不是 employeeId
 */
export default function EmployeeDetailPage() {
  const params = useParams();
  const router = useRouter();
  const subscriptionId = params.id as string;
  const [activeTab, setActiveTab] = useState('overview');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  // 从"我的硅基员工"列表中查找当前这段雇佣关系
  const { data: employees = [], isLoading, isError } = useMyEmployees();
  const employee = employees.find((emp) => emp.subscriptionId === subscriptionId);

  // 暂时禁用更新和删除功能（需要后端API支持）
  // const updateEmployee = useUpdateEmployee();
  // const deleteEmployee = useDeleteEmployee();

  // const handleDelete = () => {
  //   deleteEmployee.mutate(subscriptionId, {
  //     onSuccess: () => {
  //       router.push('/my-employees');
  //     },
  //   });
  // };

  if (isLoading) {
    return <CenteredSpinner label="加载员工详情..." />;
  }

  if (isError || !employee) {
    return (
      <div className="flex h-screen items-center justify-center">
        <EmptyState
          icon={<AlertTriangle className="h-8 w-8 text-danger" />}
          title="加载失败"
          description="未找到该硅基员工或无权访问"
          action={
            <Button variant="outline" onClick={() => router.push('/my-employees')}>
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
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsEditing(!isEditing)}
                disabled
                title="编辑功能待实现"
              >
                <Settings className="w-4 h-4 mr-2" />
                {isEditing ? '取消编辑' : '编辑'}
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => setDeleteOpen(true)}
                disabled
                title="删除功能待实现"
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
                    src={employee.employee.avatar}
                    className="w-24 h-24 text-2xl"
                  />
                </div>
                <h2 className="mt-4 text-lg font-semibold text-neutral-900">
                  {employee.name}
                </h2>
                <p className="text-sm text-neutral-600 mt-1">
                  {employee.employee.name} · v{employee.templateVersion}
                </p>
              </div>

              {/* 统计数据 */}
              <div className="space-y-3 pt-4 border-t border-neutral-200">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-neutral-600">部门</span>
                  <Badge>{employee.department?.name || '未分配'}</Badge>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-neutral-600">授权来源</span>
                  <Badge>
                    {employee.grantSource === 'DIRECT' ? '自助订阅' : '部门授权'}
                  </Badge>
                </div>
                {employee.expiresAt && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-neutral-600">到期时间</span>
                    <span className="text-sm text-neutral-900">
                      {new Date(employee.expiresAt).toLocaleDateString('zh-CN')}
                    </span>
                  </div>
                )}
              </div>

              {/* 本月统计 - 暂无数据 */}
              <div className="space-y-3 pt-4 border-t border-neutral-200">
                <h3 className="text-sm font-medium text-neutral-700">本月统计</h3>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-neutral-600">调用次数</span>
                    <span className="font-semibold text-neutral-400">-</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-neutral-600">消费金额</span>
                    <span className="font-semibold text-neutral-400">-</span>
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
                  <TabsTrigger value="capabilities">
                    <Zap className="w-4 h-4 mr-2" />
                    能力
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
                  <TabsTrigger value="monitoring">
                    <BarChart2 className="w-4 h-4 mr-2" />
                    监控
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="mt-6">
                  <OverviewTab employee={employee} />
                </TabsContent>
                <TabsContent value="capabilities" className="mt-6">
                  <CapabilitiesTab />
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
                <TabsContent value="monitoring" className="mt-6">
                  <MonitoringTab employeeId={subscriptionId} />
                </TabsContent>
              </Tabs>
            </Card>
          </div>
        </div>
      </div>

      {/* 删除确认对话框 - 暂时禁用 */}
      {/* <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="删除员工"
        description={`确定要删除员工「${employee.name}」吗？此操作不可撤销，员工的所有数据和历史记录都将被删除。`}
        confirmText="删除"
        variant="danger"
        loading={false}
        onConfirm={() => {}}
      /> */}
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
          {employee.employee.name} · 硅基员工
        </p>
      </div>

      {/* 基本信息 */}
      <div>
        <h3 className="text-base font-semibold text-neutral-900 mb-3">基本信息</h3>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-neutral-600">雇佣关系ID：</span>
            <span className="font-medium font-mono text-xs">{employee.subscriptionId}</span>
          </div>
          <div>
            <span className="text-neutral-600">模板版本：</span>
            <span className="font-medium">v{employee.templateVersion}</span>
          </div>
          <div>
            <span className="text-neutral-600">授权来源：</span>
            <span className="font-medium">
              {employee.grantSource === 'DIRECT' ? '自助订阅' : '部门授权'}
            </span>
          </div>
          {employee.expiresAt && (
            <div>
              <span className="text-neutral-600">到期时间：</span>
              <span className="font-medium">{new Date(employee.expiresAt).toLocaleDateString()}</span>
            </div>
          )}
        </div>
      </div>

      {/* 提示 */}
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
        <p className="text-sm text-blue-900">
          💡 更多详细信息和能力配置，请访问「员工授权」页面
        </p>
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
    <div className="flex flex-col items-center py-16 text-neutral-400">
      <Sliders className="mb-3 h-10 w-10 opacity-30" />
      <p className="text-sm">配置功能待实现</p>
      <p className="mt-2 text-xs text-neutral-500">请访问「员工授权」页面进行配置</p>
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

// ---- 能力类型配置 ----
const CAPABILITY_TYPE_META: Record<string, { label: string; color: string; bg: string }> = {
  AGENT:   { label: 'Agent',   color: 'text-violet-700', bg: 'bg-violet-50 border-violet-200' },
  RPA:     { label: 'RPA',     color: 'text-blue-700',   bg: 'bg-blue-50 border-blue-200'     },
  SKILL:   { label: 'Skill',   color: 'text-emerald-700',bg: 'bg-emerald-50 border-emerald-200'},
  AI_APP:  { label: 'AI App',  color: 'text-orange-700', bg: 'bg-orange-50 border-orange-200' },
};

function capTypeMeta(type: string) {
  return CAPABILITY_TYPE_META[type] ?? { label: type, color: 'text-neutral-700', bg: 'bg-neutral-50 border-neutral-200' };
}

/** 将 JSON Schema 的 properties 提取为 [{name, type, required, description}] */
function schemaToFields(schema: Record<string, unknown> | null) {
  if (!schema || typeof schema !== 'object') return [];
  const props = (schema as any).properties ?? {};
  const required: string[] = (schema as any).required ?? [];
  return Object.entries(props).map(([name, def]: [string, any]) => ({
    name,
    type: def?.type ?? 'any',
    required: required.includes(name),
    description: def?.description ?? '',
  }));
}

function SchemaFields({ fields, empty }: { fields: ReturnType<typeof schemaToFields>; empty: string }) {
  if (fields.length === 0) {
    return <p className="text-xs text-neutral-400 italic">{empty}</p>;
  }
  return (
    <ul className="space-y-1.5">
      {fields.map((f) => (
        <li key={f.name} className="flex flex-wrap items-baseline gap-x-2 text-xs">
          <code className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-neutral-800">{f.name}</code>
          <span className="text-neutral-400">{f.type}</span>
          {f.required && (
            <span className="rounded bg-red-50 px-1 text-red-500">必填</span>
          )}
          {f.description && (
            <span className="text-neutral-500">{f.description}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function CapabilitiesTab() {
  return (
    <div className="flex flex-col items-center py-16 text-neutral-400">
      <Zap className="mb-3 h-10 w-10 opacity-30" />
      <p className="text-sm">能力信息请访问「员工授权」页面查看</p>
    </div>
  );
}

// ============ 监控仪表盘 ============

const DAYS_OPTIONS = [
  { label: '近 7 天', value: 7 },
  { label: '近 30 天', value: 30 },
];

function MonitoringTab({ employeeId }: { employeeId: string }) {
  return (
    <div className="flex flex-col items-center py-16 text-neutral-400">
      <BarChart2 className="mb-3 h-10 w-10 opacity-30" />
      <p className="text-sm">监控数据待实现</p>
      <p className="mt-2 text-xs text-neutral-500">敬请期待运行监控和数据分析功能</p>
    </div>
  );
}


function StatCard({
  label,
  value,
  sub,
  valueClass,
}: {
  label: string;
  value: string | number;
  sub: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold text-neutral-900 ${valueClass ?? ''}`}>{value}</p>
      <p className="mt-0.5 text-xs text-neutral-400">{sub}</p>
    </div>
  );
}
