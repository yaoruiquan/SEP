'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useEnterpriseQuotas, useAllocateEnterpriseQuota } from '@/lib/api/use-quota';
import { Loader2, Plus, Building2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';

function fmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function pct(used: number, total: number) {
  if (total === 0) return 0;
  return Math.min(100, Math.round((used / total) * 100));
}

function barColor(usedPct: number) {
  const rem = 100 - usedPct;
  if (rem <= 20) return 'bg-red-500';
  if (rem <= 40) return 'bg-yellow-400';
  return 'bg-emerald-500';
}

function pctLabel(usedPct: number) {
  const rem = 100 - usedPct;
  if (rem <= 20) return 'text-red-500';
  if (rem <= 40) return 'text-yellow-500';
  return 'text-emerald-600';
}

function typeBadge(type: string) {
  const map: Record<string, { label: string; className: string }> = {
    FREE:     { label: '免费',   className: 'bg-gray-100 text-gray-600' },
    STANDARD: { label: '标准',   className: 'bg-blue-100 text-blue-700' },
    PREMIUM:  { label: '高级',   className: 'bg-purple-100 text-purple-700' },
  };
  const c = map[type] || { label: type, className: 'bg-gray-100 text-gray-600' };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${c.className}`}>
      {c.label}
    </span>
  );
}

function statusBadge(status: string) {
  const map: Record<string, { label: string; className: string }> = {
    ACTIVE:    { label: '活跃',   className: 'bg-emerald-100 text-emerald-700' },
    EXHAUSTED: { label: '已用尽', className: 'bg-red-100 text-red-600' },
    EXPIRED:   { label: '已过期', className: 'bg-gray-100 text-gray-500' },
  };
  const c = map[status] || { label: status, className: 'bg-gray-100 text-gray-500' };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${c.className}`}>
      {c.label}
    </span>
  );
}

export function EnterpriseQuotaTab() {
  const { data: quotas, isLoading } = useEnterpriseQuotas();
  const allocateMutation = useAllocateEnterpriseQuota();
  const { toast } = useToast();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({
    type: 'STANDARD' as 'FREE' | 'STANDARD' | 'PREMIUM',
    totalTokens: '',
    expiresAt: '',
  });

  const handleAllocate = async () => {
    const totalTokens = parseInt(form.totalTokens, 10);
    if (isNaN(totalTokens) || totalTokens <= 0) {
      toast({ title: '输入错误', description: '请输入有效的配额数量', variant: 'destructive' });
      return;
    }
    try {
      await allocateMutation.mutateAsync({
        type: form.type,
        totalTokens,
        expiresAt: form.expiresAt || undefined,
      });
      toast({ title: '分配成功', description: `已分配 ${fmt(totalTokens)} tokens 到企业池` });
      setDialogOpen(false);
    } catch (error: any) {
      toast({ title: '分配失败', description: error?.message || '请稍后重试', variant: 'destructive' });
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>企业配额池</CardTitle>
            <CardDescription>个人与订阅配额用尽后兜底使用（Priority 2）</CardDescription>
          </div>
          <Button onClick={() => { setForm({ type: 'STANDARD', totalTokens: '', expiresAt: '' }); setDialogOpen(true); }}>
            <Plus className="mr-2 h-4 w-4" />
            新增配额
          </Button>
        </CardHeader>
        <CardContent>
          {quotas && quotas.length > 0 ? (
            <div className="space-y-3">
              {quotas.map((quota) => {
                const p = pct(quota.usedTokens, quota.totalTokens);
                return (
                  <div
                    key={quota.id}
                    className="flex items-center gap-4 rounded-xl border bg-white p-4 shadow-sm"
                  >
                    {/* Icon */}
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-purple-100">
                      <Building2 className="h-5 w-5 text-purple-600" />
                    </div>

                    {/* Meta + progress */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">企业配额池</span>
                        {typeBadge(quota.type)}
                        {statusBadge(quota.status)}
                        <span className="text-xs text-muted-foreground">P{quota.priority}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(quota.createdAt), 'yyyy/MM/dd', { locale: zhCN })}
                        {quota.expiresAt && (
                          <> · 到期 {format(new Date(quota.expiresAt), 'yyyy/MM/dd', { locale: zhCN })}</>
                        )}
                      </p>
                      <div className="mt-2">
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="text-muted-foreground">
                            {fmt(quota.usedTokens)} / {fmt(quota.totalTokens)}
                          </span>
                          <span className={`font-semibold ${pctLabel(p)}`}>{100 - p}% 剩余</span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className={`h-1.5 rounded-full transition-all duration-500 ${barColor(p)}`}
                            style={{ width: `${100 - p}%` }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Remaining */}
                    <div className="shrink-0 text-right">
                      <span className="text-lg font-bold tabular-nums">
                        {fmt(quota.totalTokens - quota.usedTokens)}
                      </span>
                      <p className="text-xs text-muted-foreground">剩余</p>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="py-12 text-center text-muted-foreground">
              <Building2 className="mx-auto mb-4 h-12 w-12 opacity-40" />
              <p className="font-medium">暂无企业配额池</p>
              <p className="mt-1 text-sm">点击右上角"新增配额"按钮进行分配</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>分配企业配额池</DialogTitle>
            <DialogDescription>为企业配额池分配算力配额</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>配额类型</Label>
              <Select
                value={form.type}
                onValueChange={(v: 'FREE' | 'STANDARD' | 'PREMIUM') =>
                  setForm({ ...form, type: v })
                }
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="FREE">免费配额</SelectItem>
                  <SelectItem value="STANDARD">标准配额</SelectItem>
                  <SelectItem value="PREMIUM">高级配额</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ent-tokens">配额数量 (tokens)</Label>
              <Input
                id="ent-tokens"
                type="number"
                min={1}
                placeholder="例如：1000000"
                value={form.totalTokens}
                onChange={(e) => setForm({ ...form, totalTokens: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">建议值：1M（标准）/ 5M（高级）</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ent-expires">过期时间（可选）</Label>
              <Input
                id="ent-expires"
                type="date"
                value={form.expiresAt}
                onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">留空表示永久有效</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button onClick={handleAllocate} disabled={allocateMutation.isPending}>
              {allocateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              确认分配
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
