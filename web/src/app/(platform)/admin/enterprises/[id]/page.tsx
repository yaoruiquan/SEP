'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  useEnterpriseDetail,
  useCreditAdjustment,
  useSuspendEnterprise,
  useResumeEnterprise,
} from '@/features/admin/use-admin';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Building2,
  Users,
  Bot,
  DollarSign,
  ArrowLeft,
  Plus,
  Minus,
  Lock,
  Unlock,
} from 'lucide-react';

export default function EnterpriseDetailPage() {
  const params = useParams();
  const router = useRouter();
  const enterpriseId = params.id as string;

  const { data: enterprise, isLoading, error } = useEnterpriseDetail(enterpriseId);
  const creditAdjustment = useCreditAdjustment();
  const suspendEnterprise = useSuspendEnterprise();
  const resumeEnterprise = useResumeEnterprise();

  const [activeTab, setActiveTab] = useState<'members' | 'instances' | 'transactions'>('members');

  // Credit dialog state
  const [creditDialogOpen, setCreditDialogOpen] = useState(false);
  const [creditType, setCreditType] = useState<'RECHARGE' | 'DEDUCT'>('RECHARGE');
  const [creditAmount, setCreditAmount] = useState('');
  const [creditNote, setCreditNote] = useState('');

  // Suspend dialog state
  const [suspendDialogOpen, setSuspendDialogOpen] = useState(false);
  const [suspendReason, setSuspendReason] = useState('');

  const isSuspended = enterprise?.metadata?.suspended === true;

  const handleCreditAdjustment = async () => {
    const amount = parseFloat(creditAmount);
    if (isNaN(amount) || amount <= 0) {
      alert('请输入有效的金额');
      return;
    }

    if (!creditNote.trim()) {
      alert('请输入备注');
      return;
    }

    try {
      await creditAdjustment.mutateAsync({
        id: enterpriseId,
        data: {
          amount,
          type: creditType,
          note: creditNote,
        },
      });
      alert(`${creditType === 'RECHARGE' ? '充值' : '扣减'}成功`);
      setCreditDialogOpen(false);
      setCreditAmount('');
      setCreditNote('');
    } catch (err: any) {
      alert(`操作失败: ${err.message || '请稍后重试'}`);
    }
  };

  const handleSuspend = async () => {
    if (!suspendReason.trim()) {
      alert('请输入冻结原因');
      return;
    }

    try {
      await suspendEnterprise.mutateAsync({
        id: enterpriseId,
        data: { reason: suspendReason },
      });
      alert('企业已冻结');
      setSuspendDialogOpen(false);
      setSuspendReason('');
    } catch (err: any) {
      alert(`冻结失败: ${err.message || '请稍后重试'}`);
    }
  };

  const handleResume = async () => {
    if (!confirm('确认解冻该企业？')) return;

    try {
      await resumeEnterprise.mutateAsync(enterpriseId);
      alert('企业已解冻');
    } catch (err: any) {
      alert(`解冻失败: ${err.message || '请稍后重试'}`);
    }
  };

  if (isLoading) {
    return (
      <div className="container mx-auto py-8">
        <div className="text-center text-fg-muted">加载中...</div>
      </div>
    );
  }

  if (error || !enterprise) {
    return (
      <div className="container mx-auto py-8">
        <div className="text-center text-danger">
          加载失败: {(error as Error)?.message || '企业不存在'}
        </div>
      </div>
    );
  }

  const balance = enterprise.computeAccount?.balance ?? 0;

  return (
    <div className="container mx-auto py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push('/admin/enterprises')}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              {enterprise.name}
              {isSuspended && (
                <Badge className="bg-danger text-white">已冻结</Badge>
              )}
            </h1>
            {enterprise.description && (
              <p className="text-fg-muted mt-1">{enterprise.description}</p>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setCreditType('RECHARGE');
              setCreditAmount('');
              setCreditNote('');
              setCreditDialogOpen(true);
            }}
          >
            <Plus className="h-4 w-4 mr-2" />
            充值
          </Button>

          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setCreditType('DEDUCT');
              setCreditAmount('');
              setCreditNote('');
              setCreditDialogOpen(true);
            }}
          >
            <Minus className="h-4 w-4 mr-2" />
            扣减
          </Button>

          {isSuspended ? (
            <Button variant="secondary" size="sm" onClick={handleResume}>
              <Unlock className="h-4 w-4 mr-2" />
              解冻
            </Button>
          ) : (
            <Button variant="danger" size="sm" onClick={() => setSuspendDialogOpen(true)}>
              <Lock className="h-4 w-4 mr-2" />
              冻结
            </Button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">算力余额</CardTitle>
            <DollarSign className="h-4 w-4 text-fg-muted" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">¥{balance.toFixed(2)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">成员数量</CardTitle>
            <Users className="h-4 w-4 text-fg-muted" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{enterprise.members.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">实例数量</CardTitle>
            <Bot className="h-4 w-4 text-fg-muted" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{enterprise.instances.length}</div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <div className="space-y-4">
        <div className="flex gap-2 border-b border-border">
          <button
            className={`px-4 py-2 font-medium ${
              activeTab === 'members'
                ? 'border-b-2 border-primary text-primary'
                : 'text-fg-muted hover:text-foreground'
            }`}
            onClick={() => setActiveTab('members')}
          >
            成员
          </button>
          <button
            className={`px-4 py-2 font-medium ${
              activeTab === 'instances'
                ? 'border-b-2 border-primary text-primary'
                : 'text-fg-muted hover:text-foreground'
            }`}
            onClick={() => setActiveTab('instances')}
          >
            实例
          </button>
          <button
            className={`px-4 py-2 font-medium ${
              activeTab === 'transactions'
                ? 'border-b-2 border-primary text-primary'
                : 'text-fg-muted hover:text-foreground'
            }`}
            onClick={() => setActiveTab('transactions')}
          >
            交易记录
          </button>
        </div>

        {activeTab === 'members' && (
          <Card>
            <CardHeader>
              <CardTitle>企业成员 ({enterprise.members.length})</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-fg-muted">
                    <th className="px-5 py-2 text-left font-medium">用户</th>
                    <th className="px-5 py-2 text-left font-medium">角色</th>
                    <th className="px-5 py-2 text-left font-medium">部门</th>
                    <th className="px-5 py-2 text-left font-medium">系统角色</th>
                  </tr>
                </thead>
                <tbody>
                  {enterprise.members.map((member) => (
                    <tr key={member.id} className="border-b border-border last:border-0">
                      <td className="px-5 py-3">
                        <div>
                          <div className="font-medium">
                            {member.user.name || member.user.email}
                          </div>
                          {member.user.name && (
                            <div className="text-xs text-fg-muted">
                              {member.user.email}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <Badge className="bg-muted text-foreground">{member.role}</Badge>
                      </td>
                      <td className="px-5 py-3">{member.department?.name || '-'}</td>
                      <td className="px-5 py-3">
                        <Badge className="bg-primary text-white">{member.user.role}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}

        {activeTab === 'instances' && (
          <Card>
            <CardHeader>
              <CardTitle>员工实例 ({enterprise.instances.length})</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-fg-muted">
                    <th className="px-5 py-2 text-left font-medium">名称</th>
                    <th className="px-5 py-2 text-left font-medium">模板</th>
                    <th className="px-5 py-2 text-left font-medium">版本</th>
                    <th className="px-5 py-2 text-left font-medium">部门</th>
                    <th className="px-5 py-2 text-left font-medium">状态</th>
                    <th className="px-5 py-2 text-left font-medium">创建时间</th>
                  </tr>
                </thead>
                <tbody>
                  {enterprise.instances.map((instance) => (
                    <tr key={instance.id} className="border-b border-border last:border-0">
                      <td className="px-5 py-3 font-medium">{instance.name}</td>
                      <td className="px-5 py-3">{instance.template.name}</td>
                      <td className="px-5 py-3 font-mono text-xs">
                        {instance.templateVersion}
                      </td>
                      <td className="px-5 py-3">{instance.department?.name || '-'}</td>
                      <td className="px-5 py-3">
                        <Badge
                          className={
                            instance.status === 'ACTIVE'
                              ? 'bg-green-100 text-green-800'
                              : 'bg-muted text-foreground'
                          }
                        >
                          {instance.status}
                        </Badge>
                      </td>
                      <td className="px-5 py-3 text-fg-muted">
                        {new Date(instance.createdAt).toLocaleString('zh-CN')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}

        {activeTab === 'transactions' && (
          <Card>
            <CardHeader>
              <CardTitle>
                交易记录 ({enterprise.computeAccount?.transactions.length || 0})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {!enterprise.computeAccount?.transactions.length ? (
                <div className="text-center py-8 text-fg-muted">暂无交易记录</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40 text-fg-muted">
                      <th className="px-5 py-2 text-left font-medium">类型</th>
                      <th className="px-5 py-2 text-right font-medium">金额</th>
                      <th className="px-5 py-2 text-left font-medium">说明</th>
                      <th className="px-5 py-2 text-left font-medium">时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {enterprise.computeAccount.transactions.map((tx) => (
                      <tr key={tx.id} className="border-b border-border last:border-0">
                        <td className="px-5 py-3">
                          <Badge
                            className={
                              tx.type === 'RECHARGE'
                                ? 'bg-green-100 text-green-800'
                                : tx.type === 'REFUND'
                                ? 'bg-blue-100 text-blue-800'
                                : 'bg-muted text-foreground'
                            }
                          >
                            {tx.type}
                          </Badge>
                        </td>
                        <td
                          className={`px-5 py-3 text-right font-mono ${
                            tx.amount > 0 ? 'text-green-600' : 'text-red-600'
                          }`}
                        >
                          {tx.amount > 0 ? '+' : ''}
                          ¥{tx.amount.toFixed(2)}
                        </td>
                        <td className="px-5 py-3">{tx.description || '-'}</td>
                        <td className="px-5 py-3 text-fg-muted">
                          {new Date(tx.createdAt).toLocaleString('zh-CN')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Suspend Warning */}
      {isSuspended && enterprise.metadata?.suspendReason && (
        <Card className="border-danger">
          <CardHeader>
            <CardTitle className="text-danger">冻结信息</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              <div>
                <span className="text-fg-muted">冻结原因:</span>
                <p className="mt-1">{enterprise.metadata.suspendReason}</p>
              </div>
              {enterprise.metadata.suspendedAt && (
                <div>
                  <span className="text-fg-muted">冻结时间:</span>
                  <p className="mt-1">
                    {new Date(enterprise.metadata.suspendedAt).toLocaleString('zh-CN')}
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Credit Dialog */}
      {creditDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>
                {creditType === 'RECHARGE' ? '充值算力' : '扣减算力'}
              </CardTitle>
              <p className="text-sm text-fg-muted mt-1">
                当前余额: ¥{balance.toFixed(2)}
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Button
                  variant={creditType === 'RECHARGE' ? 'primary' : 'secondary'}
                  onClick={() => setCreditType('RECHARGE')}
                  className="flex-1"
                >
                  充值
                </Button>
                <Button
                  variant={creditType === 'DEDUCT' ? 'primary' : 'secondary'}
                  onClick={() => setCreditType('DEDUCT')}
                  className="flex-1"
                >
                  扣减
                </Button>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">金额（元）</label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="请输入金额"
                  value={creditAmount}
                  onChange={(e) => setCreditAmount(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">备注</label>
                <textarea
                  className="w-full px-3 py-2 border border-border rounded resize-none"
                  placeholder="请输入操作备注"
                  value={creditNote}
                  onChange={(e) => setCreditNote(e.target.value)}
                  rows={3}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="secondary"
                  onClick={() => setCreditDialogOpen(false)}
                >
                  取消
                </Button>
                <Button
                  onClick={handleCreditAdjustment}
                  disabled={creditAdjustment.isPending}
                >
                  {creditAdjustment.isPending ? '处理中...' : '确认'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Suspend Dialog */}
      {suspendDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>冻结企业</CardTitle>
              <p className="text-sm text-fg-muted mt-1">
                冻结后该企业将无法使用平台服务
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">冻结原因</label>
                <textarea
                  className="w-full px-3 py-2 border border-border rounded resize-none"
                  placeholder="请输入冻结原因"
                  value={suspendReason}
                  onChange={(e) => setSuspendReason(e.target.value)}
                  rows={4}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="secondary"
                  onClick={() => setSuspendDialogOpen(false)}
                >
                  取消
                </Button>
                <Button
                  variant="danger"
                  onClick={handleSuspend}
                  disabled={suspendEnterprise.isPending}
                >
                  {suspendEnterprise.isPending ? '处理中...' : '确认冻结'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
