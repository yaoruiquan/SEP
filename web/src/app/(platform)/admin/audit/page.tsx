'use client';

import { useState } from 'react';
import { CheckCircle, XCircle, Clock, AlertTriangle, Users, Layers } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { EmptyState } from '@/components/ui/feedback';
import { useToast } from '@/hooks/use-toast';
import {
  usePendingCapabilities,
  usePendingEmployees,
  useApproveCapability,
  useRejectCapability,
  useApproveEmployee,
  useRejectEmployee,
} from '@/features/audit/use-audit';
import { AuditListSkeleton } from '@/features/audit/audit-skeleton';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';

type AuditStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

interface EmployeeAuditItem {
  id: string;
  name: string;
  avatar: string | null;
  industry: string[];
  position: string[];
  capabilityCount: number;
  submittedAt: string;
  status: AuditStatus;
  description: string;
  capabilities: Array<{ id: string; name: string; type: string; status: AuditStatus }>;
}

interface CapabilityAuditItem {
  id: string;
  name: string;
  type: 'AGENT' | 'SKILL' | 'RPA' | 'AI_APP';
  description: string;
  industry: string[];
  position: string[];
  submittedAt: string;
  status: AuditStatus;
  inputSchema: object;
  outputSchema: object;
}

// 深底上的类型徽章：不用 500 级实心填充（白字压纯色在深底会「发光」抢注意力），
// 改成玻璃底 + 品牌色文字，与 admin/page.tsx 的 TYPE_COLORS 保持同一套配方。
const CAPABILITY_TYPE_COLORS: Record<string, string> = {
  AGENT: 'border border-glassline bg-glass-2 text-gneon-blue',
  SKILL: 'border border-glassline bg-glass-2 text-gneon-green',
  RPA: 'border border-glassline bg-glass-2 text-gwarning',
  AI_APP: 'border border-glassline bg-glass-2 text-gneon-purple',
};

export default function AuditPage() {
  const [activeTab, setActiveTab] = useState<'employees' | 'capabilities'>('capabilities');
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeAuditItem | null>(null);
  const [selectedCapability, setSelectedCapability] = useState<CapabilityAuditItem | null>(null);

  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [approveComment, setApproveComment] = useState('');
  const [rejectReason, setRejectReason] = useState('');

  const { toast } = useToast();

  // 获取数据
  const { data: pendingEmployees = [], isLoading: loadingEmployees } = usePendingEmployees();
  const { data: capabilitiesData, isLoading: loadingCapabilities } = usePendingCapabilities();
  const pendingCapabilities = capabilitiesData?.data || [];

  // Mutations
  const approveCapabilityMutation = useApproveCapability();
  const rejectCapabilityMutation = useRejectCapability();
  const approveEmployeeMutation = useApproveEmployee();
  const rejectEmployeeMutation = useRejectEmployee();

  const handleApprove = async () => {
    try {
      if (activeTab === 'capabilities' && selectedCapability) {
        await approveCapabilityMutation.mutateAsync({
          id: selectedCapability.id,
          comment: approveComment
        });
        toast({ title: '审核通过', description: `能力 "${selectedCapability.name}" 已通过审核` });
        setSelectedCapability(null);
      } else if (activeTab === 'employees' && selectedEmployee) {
        await approveEmployeeMutation.mutateAsync({
          id: selectedEmployee.id,
          comment: approveComment
        });
        toast({ title: '审核通过', description: `员工 "${selectedEmployee.name}" 已通过审核` });
        setSelectedEmployee(null);
      }
      setApproveOpen(false);
      setApproveComment('');
    } catch (error) {
      toast({
        title: '审核失败',
        description: error instanceof Error ? error.message : '操作失败',
        variant: 'destructive'
      });
    }
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) return;

    try {
      if (activeTab === 'capabilities' && selectedCapability) {
        await rejectCapabilityMutation.mutateAsync({
          id: selectedCapability.id,
          reason: rejectReason
        });
        toast({ title: '已拒绝', description: `能力 "${selectedCapability.name}" 审核被拒绝` });
        setSelectedCapability(null);
      } else if (activeTab === 'employees' && selectedEmployee) {
        await rejectEmployeeMutation.mutateAsync({
          id: selectedEmployee.id,
          reason: rejectReason
        });
        toast({ title: '已拒绝', description: `员工 "${selectedEmployee.name}" 审核被拒绝` });
        setSelectedEmployee(null);
      }
      setRejectOpen(false);
      setRejectReason('');
    } catch (error) {
      toast({
        title: '操作失败',
        description: error instanceof Error ? error.message : '操作失败',
        variant: 'destructive'
      });
    }
  };

  const isLoading = loadingEmployees || loadingCapabilities;

  return (
    <div className="flex h-full flex-col">
      {/* 页头 */}
      <div className="border-b border-border bg-background px-6 py-4">
        <h1 className="text-2xl font-bold">审核中心</h1>
        <p className="text-sm text-fg-muted mt-1">审核待上架的员工和能力</p>
      </div>

      {/* Tab 导航 */}
      <div className="border-b border-border bg-background px-6">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
          <TabsList className="bg-transparent h-auto gap-1 p-0 rounded-none">
            <TabsTrigger
              value="employees"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary"
            >
              员工审核
              <Badge className="ml-1.5 bg-muted text-fg-muted">
                {pendingEmployees.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger
              value="capabilities"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary"
            >
              能力审核
              <Badge className="ml-1.5 bg-muted text-fg-muted">
                {pendingCapabilities.length}
              </Badge>
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* 内容区 - 左右分屏 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧：待审列表 (40%) */}
        <div className="w-2/5 border-r border-border bg-background overflow-y-auto">
          {activeTab === 'employees' ? (
            <div className="p-4 space-y-2">
              {isLoading ? (
                <AuditListSkeleton count={3} />
              ) : pendingEmployees.length === 0 ? (
                <div className="flex items-center justify-center h-64">
                  <EmptyState
                    icon={<Users className="h-8 w-8" />}
                    title="暂无待审核员工"
                    description="所有员工审核已完成"
                  />
                </div>
              ) : (
                pendingEmployees.map((item: any) => (
                  <Card
                    key={item.id}
                    className={`p-4 cursor-pointer transition-colors hover:bg-accent ${
                      selectedEmployee?.id === item.id ? 'bg-accent border-primary' : ''
                    }`}
                    onClick={() => setSelectedEmployee(item)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-medium truncate">{item.name}</h3>
                          {item.capabilities?.some((c: any) => c.status === 'PENDING') && (
                            <Badge className="shrink-0 border border-gwarning/30 bg-gwarning/12 text-gwarning text-xs">
                              含待审能力
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-fg-muted mb-2">
                          <span>{item.position?.join(', ') || '未设置岗位'}</span>
                          <span>•</span>
                          <span>{item.capabilityCount || 0} 个能力</span>
                        </div>
                        <div className="text-xs text-fg-subtle">
                          {formatDistanceToNow(new Date(item.submittedAt || item.createdAt), {
                            addSuffix: true,
                            locale: zhCN,
                          })}
                        </div>
                      </div>
                      <Clock className="h-4 w-4 text-gwarning shrink-0" />
                    </div>
                  </Card>
                ))
              )}
            </div>
          ) : (
            <div className="p-4 space-y-2">
              {isLoading ? (
                <AuditListSkeleton count={3} />
              ) : pendingCapabilities.length === 0 ? (
                <div className="flex items-center justify-center h-64">
                  <EmptyState
                    icon={<Layers className="h-8 w-8" />}
                    title="暂无待审核能力"
                    description="所有能力审核已完成"
                  />
                </div>
              ) : (
                pendingCapabilities.map((item: any) => (
                  <Card
                    key={item.id}
                    className={`p-4 cursor-pointer transition-colors hover:bg-accent ${
                      selectedCapability?.id === item.id ? 'bg-accent border-primary' : ''
                    }`}
                    onClick={() => setSelectedCapability(item)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-medium truncate">{item.name}</h3>
                          <Badge className={`shrink-0 text-xs ${CAPABILITY_TYPE_COLORS[item.type] || 'border border-glassline bg-glass-2 text-gtext-secondary'}`}>
                            {item.type}
                          </Badge>
                        </div>
                        <p className="text-xs text-fg-muted mb-2 line-clamp-2">{item.description}</p>
                        <div className="text-xs text-fg-subtle">
                          {formatDistanceToNow(new Date(item.createdAt), {
                            addSuffix: true,
                            locale: zhCN,
                          })}
                        </div>
                      </div>
                      <Clock className="h-4 w-4 text-gwarning shrink-0" />
                    </div>
                  </Card>
                ))
              )}
            </div>
          )}
        </div>

        {/* 右侧：审核详情 (60%) */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {activeTab === 'employees' && selectedEmployee ? (
            <EmployeeAuditDetail
              employee={selectedEmployee}
              onApprove={() => setApproveOpen(true)}
              onReject={() => setRejectOpen(true)}
            />
          ) : activeTab === 'capabilities' && selectedCapability ? (
            <CapabilityAuditDetail
              capability={selectedCapability}
              onApprove={() => setApproveOpen(true)}
              onReject={() => setRejectOpen(true)}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-fg-muted">
              <p>请从左侧列表选择一项进行审核</p>
            </div>
          )}
        </div>
      </div>

      {/* 通过审核 Modal */}
      <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认通过审核</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-fg-muted">
              审核通过后，该{activeTab === 'employees' ? '员工' : '能力'}将自动上架到市场。
            </p>
            <div>
              <label className="block text-sm font-medium mb-2">审核意见（选填）</label>
              <Textarea
                value={approveComment}
                onChange={(e) => setApproveComment(e.target.value)}
                placeholder="填写审核意见..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setApproveOpen(false)}>
              取消
            </Button>
            <Button onClick={handleApprove}>
              <CheckCircle className="h-4 w-4 mr-1" />
              确认通过
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 拒绝审核 Modal */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>拒绝审核</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-fg-muted">
              请说明拒绝原因，提交人将收到通知。
            </p>
            <div>
              <label className="block text-sm font-medium mb-2">拒绝原因（必填）</label>
              <Textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="请详细说明拒绝原因..."
                rows={4}
                className={!rejectReason.trim() ? 'border-gdanger' : ''}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejectOpen(false)}>
              取消
            </Button>
            <Button
              variant="danger"
              onClick={handleReject}
              disabled={!rejectReason.trim()}
            >
              <XCircle className="h-4 w-4 mr-1" />
              确认拒绝
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// 员工审核详情组件
function EmployeeAuditDetail({
  employee,
  onApprove,
  onReject,
}: {
  employee: EmployeeAuditItem;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl space-y-6">
          {/* 基本信息 */}
          <Card className="p-6">
            <div className="flex items-start gap-4 mb-4">
              <div className="h-20 w-20 rounded-glass-lg bg-gradient-to-br from-gbrand to-gneon-purple flex items-center justify-center text-white text-2xl font-bold shrink-0">
                {employee.name.charAt(0)}
              </div>
              <div className="flex-1">
                <h2 className="text-xl font-bold mb-2">{employee.name}</h2>
                <div className="flex items-center gap-2 mb-2">
                  {employee.industry.map((ind) => (
                    <Badge key={ind} className="bg-blue-100 text-blue-700">
                      {ind}
                    </Badge>
                  ))}
                  {employee.position.map((pos) => (
                    <Badge key={pos} className="bg-green-100 text-green-700">
                      {pos}
                    </Badge>
                  ))}
                </div>
                <p className="text-sm text-fg-muted">{employee.description}</p>
              </div>
            </div>
          </Card>

          {/* 绑定能力检查 */}
          <Card className="p-6">
            <h3 className="font-semibold mb-4">绑定能力 ({employee.capabilityCount} 个)</h3>
            <div className="space-y-2">
              {employee.capabilities.map((cap) => (
                <div key={cap.id} className="flex items-center justify-between p-3 rounded-lg border border-border">
                  <div className="flex items-center gap-3">
                    <span className="text-fg-muted">{cap.name}</span>
                    <Badge className={`text-white text-xs ${CAPABILITY_TYPE_COLORS[cap.type]}`}>
                      {cap.type}
                    </Badge>
                  </div>
                  {cap.status === 'APPROVED' ? (
                    <Badge className="bg-green-100 text-green-700 text-xs">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      已审核
                    </Badge>
                  ) : (
                    <Badge className="bg-amber-100 text-amber-700 text-xs">
                      <Clock className="h-3 w-3 mr-1" />
                      待审核
                    </Badge>
                  )}
                </div>
              ))}
            </div>

            {employee.capabilities.some(c => c.status === 'PENDING') && (
              <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
                <AlertTriangle className="h-5 w-5 text-gwarning shrink-0 mt-0.5" />
                <div className="text-sm text-amber-800">
                  <p className="font-medium">提示：存在未审核的能力</p>
                  <p className="mt-1">建议先审核完所有能力后再审核员工</p>
                </div>
              </div>
            )}
          </Card>

          {/* 审核检查清单 */}
          <Card className="p-6 bg-blue-50 border-blue-200">
            <h3 className="font-semibold mb-3 text-blue-900">审核检查清单</h3>
            <div className="space-y-2 text-sm text-blue-800">
              <div className="flex items-center gap-2">
                <input type="checkbox" className="h-4 w-4" />
                <span>员工介绍清晰，能力边界明确</span>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" className="h-4 w-4" />
                <span>所有绑定能力已审核通过</span>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" className="h-4 w-4" />
                <span>行业和岗位标签准确</span>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" className="h-4 w-4" />
                <span>无违规内容</span>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* 底部操作栏 */}
      <div className="border-t border-border bg-background p-4 flex items-center justify-end gap-3">
        <Button variant="outline" onClick={onReject}>
          <XCircle className="h-4 w-4 mr-1" />
          拒绝
        </Button>
        <Button onClick={onApprove}>
          <CheckCircle className="h-4 w-4 mr-1" />
          通过审核
        </Button>
      </div>
    </>
  );
}

// 能力审核详情组件
function CapabilityAuditDetail({
  capability,
  onApprove,
  onReject,
}: {
  capability: CapabilityAuditItem;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl space-y-6">
          {/* 基本信息 */}
          <Card className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <h2 className="text-xl font-bold">{capability.name}</h2>
              <Badge className={`text-white ${CAPABILITY_TYPE_COLORS[capability.type]}`}>
                {capability.type}
              </Badge>
            </div>
            <p className="text-fg-muted mb-4">{capability.description}</p>
            <div className="flex items-center gap-2">
              {capability.industry.map((ind) => (
                <Badge key={ind} className="bg-blue-100 text-blue-700">
                  {ind}
                </Badge>
              ))}
              {capability.position.map((pos) => (
                <Badge key={pos} className="bg-green-100 text-green-700">
                  {pos}
                </Badge>
              ))}
            </div>
          </Card>

          {/* Schema 检查 */}
          <Card className="p-6">
            <h3 className="font-semibold mb-4">接口定义</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">输入 Schema</label>
                <pre className="p-3 bg-muted rounded-lg text-xs overflow-x-auto">
                  {JSON.stringify(capability.inputSchema, null, 2)}
                </pre>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">输出 Schema</label>
                <pre className="p-3 bg-muted rounded-lg text-xs overflow-x-auto">
                  {JSON.stringify(capability.outputSchema, null, 2)}
                </pre>
              </div>
            </div>
          </Card>

          {/* 测试执行 */}
          <Card className="p-6">
            <h3 className="font-semibold mb-4">测试执行</h3>
            <p className="text-sm text-fg-muted mb-4">
              执行测试以验证能力是否可以正常工作
            </p>
            <Button variant="outline">
              <CheckCircle className="h-4 w-4 mr-1" />
              测试执行
            </Button>
          </Card>
        </div>
      </div>

      {/* 底部操作栏 */}
      <div className="border-t border-border bg-background p-4 flex items-center justify-end gap-3">
        <Button variant="outline" onClick={onReject}>
          <XCircle className="h-4 w-4 mr-1" />
          拒绝
        </Button>
        <Button onClick={onApprove}>
          <CheckCircle className="h-4 w-4 mr-1" />
          通过审核
        </Button>
      </div>
    </>
  );
}
