'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
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
import { Textarea } from '@/components/ui/textarea';
import { useUserQuotas, useAllocateUserQuota } from '@/lib/api/use-quota';
import { Loader2, Plus, User } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

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

export function UserQuotaTab() {
  const { data: userQuotas, isLoading } = useUserQuotas();
  const allocateMutation = useAllocateUserQuota();
  const { toast } = useToast();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<{
    userId: string;
    name: string;
    email: string;
  } | null>(null);
  const [form, setForm] = useState({ totalTokens: '', notes: '' });

  const openDialog = (user: { userId: string; name: string; email: string }) => {
    setSelectedUser(user);
    setDialogOpen(true);
    setForm({ totalTokens: '', notes: '' });
  };

  const handleAllocate = async () => {
    if (!selectedUser) return;
    const totalTokens = parseInt(form.totalTokens, 10);
    if (isNaN(totalTokens) || totalTokens <= 0) {
      toast({ title: '输入错误', description: '请输入有效的配额数量', variant: 'destructive' });
      return;
    }
    try {
      await allocateMutation.mutateAsync({
        targetUserId: selectedUser.userId,   // ← backend field name
        totalTokens,
        notes: form.notes || undefined,
      });
      toast({ title: '分配成功', description: `已为 ${selectedUser.name} 分配 ${fmt(totalTokens)} tokens` });
      setDialogOpen(false);
    } catch (error: any) {
      toast({
        title: '分配失败',
        description: error?.message || '请稍后重试',
        variant: 'destructive',
      });
    }
  };

  const roleBadge = (role: string) => {
    const map: Record<string, { label: string; className: string }> = {
      ENTERPRISE_ADMIN: { label: '企业管理员', className: 'bg-blue-100 text-blue-700' },
      DEPT_MANAGER:     { label: '部门负责人', className: 'bg-purple-100 text-purple-700' },
      MEMBER:           { label: '普通成员',   className: 'bg-gray-100 text-gray-600' },
    };
    const c = map[role] || { label: role, className: 'bg-gray-100 text-gray-600' };
    return (
      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${c.className}`}>
        {c.label}
      </span>
    );
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
        <CardHeader>
          <CardTitle>碳基员工个人配额</CardTitle>
          <CardDescription>从企业可分配池为碳基员工配置额度；订阅赠送额度不足后才会使用。</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {userQuotas?.map((user) => {
              const p = user.quota ? pct(user.quota.usedTokens, user.quota.totalTokens) : 0;
              return (
                <div
                  key={user.memberId}
                  className="flex items-center gap-4 rounded-xl border bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
                >
                  {/* Avatar */}
                  <Avatar
                    name={user.name}
                    src={user.avatar}
                    className="h-10 w-10 shrink-0 text-sm"
                  />

                  {/* Name + role */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{user.name}</span>
                      {roleBadge(user.role)}
                    </div>
                    <p className="text-sm text-muted-foreground truncate">{user.email}</p>

                    {/* Progress bar inline */}
                    {user.quota ? (
                      <div className="mt-2">
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="text-muted-foreground">
                            {fmt(user.quota.usedTokens)} / {fmt(user.quota.totalTokens)}
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
                    ) : (
                      <p className="mt-1 text-xs text-muted-foreground">尚未分配配额</p>
                    )}
                  </div>

                  {/* Right: tokens + button */}
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    {user.quota ? (
                      <div className="text-right">
                        <span className="text-lg font-bold tabular-nums">
                          {fmt(user.quota.totalTokens - user.quota.usedTokens)}
                        </span>
                        <span className="ml-1 text-xs text-muted-foreground">剩余</span>
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">未分配</span>
                    )}
                    <Button
                      size="sm"
                      variant={user.quota ? 'outline' : 'primary'}
                      onClick={() => openDialog({ userId: user.userId, name: user.name, email: user.email })}
                    >
                      {user.quota ? '调整配额' : <><Plus className="mr-1 h-3.5 w-3.5" />分配配额</>}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>分配个人配额</DialogTitle>
            <DialogDescription>
              为 {selectedUser?.name} ({selectedUser?.email}) 分配算力配额
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="totalTokens">配额数量 (tokens)</Label>
              <Input
                id="totalTokens"
                type="number"
                min={1}
                placeholder="例如：50000"
                value={form.totalTokens}
                onChange={(e) => setForm({ ...form, totalTokens: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">建议值：50K（普通员工）/ 100K（管理员）</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">备注（可选）</Label>
              <Textarea
                id="notes"
                placeholder="分配原因或说明"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
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
