'use client';

import { useState } from 'react';
import { Check, Copy, Link2, Loader2, Mail, Plus, XCircle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/feedback';
import { toast } from '@/components/ui/toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ApiError } from '@/lib/api-client';
import {
  useInvitations,
  useCreateInvitation,
  useRevokeInvitation,
} from './use-enterprise';
import { flattenDepts } from './flatten-depts';
import type {
  CreatedInvitation,
  Department,
  EnterpriseInvitation,
  InvitationStatus,
} from '@/lib/types';

const STATUS_META: Record<
  InvitationStatus,
  { label: string; variant: 'glass' | 'glass-success' | 'glass-warning' | 'glass-danger' }
> = {
  PENDING: { label: '待接受', variant: 'glass-warning' },
  ACCEPTED: { label: '已加入', variant: 'glass-success' },
  EXPIRED: { label: '已过期', variant: 'glass' },
  REVOKED: { label: '已撤回', variant: 'glass-danger' },
};

const ROLE_LABEL: Record<string, string> = {
  ENTERPRISE_ADMIN: '企业管理员',
  MEMBER: '普通成员',
};

/** 由 token 拼出受邀注册页地址。用 origin 而非硬编码域名，本地/预发/线上都能直接用。 */
function buildJoinUrl(token: string): string {
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  return `${origin}/join?token=${encodeURIComponent(token)}`;
}

/**
 * 邀请链接展示框。
 *
 * 单独抽出来是因为它有个硬约束：明文 token 只在创建响应里出现一次，
 * 列表接口永远拿不到。所以这个框一关就再也找不回链接，
 * 文案必须把这点说清楚，否则管理员会以为「稍后再复制」。
 */
function InviteLinkReveal({
  invitation,
  onClose,
}: {
  invitation: CreatedInvitation;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const url = buildJoinUrl(invitation.token);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 非 HTTPS 或未授权剪贴板时会抛错，此时链接仍可手动选中复制
      toast.error('复制失败，请手动选中链接复制');
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>邀请链接已生成</DialogTitle>
          <DialogDescription>
            请立即复制并发送给 <span className="font-medium">{invitation.email}</span>。
            链接只会出现这一次，关闭后无法再次查看（如已丢失，重新邀请即可，旧链接会自动作废）。
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2">
          <code className="flex-1 break-all font-mono text-xs">{url}</code>
          <Button size="sm" variant="ghost" onClick={copy} className="shrink-0">
            {copied ? (
              <Check className="h-4 w-4 text-success" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </Button>
        </div>

        <p className="text-xs text-fg-muted">
          该链接仅对 {invitation.email} 有效，转发给他人也无法使用。
          有效期至 {new Date(invitation.expiresAt).toLocaleString('zh-CN')}。
        </p>

        <DialogFooter>
          <Button onClick={onClose}>我已复制，关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InviteDialog({
  depts,
  onClose,
  onCreated,
}: {
  depts: Department[];
  onClose: () => void;
  onCreated: (inv: CreatedInvitation) => void;
}) {
  const createInvitation = useCreateInvitation();
  const flatDepts = flattenDepts(depts);

  const [form, setForm] = useState({
    email: '',
    role: 'MEMBER' as 'ENTERPRISE_ADMIN' | 'MEMBER',
    departmentId: '',
    position: '',
  });

  const submit = () => {
    if (!form.email) return;
    createInvitation.mutate(
      {
        email: form.email.trim(),
        role: form.role,
        departmentId: form.departmentId || undefined,
        position: form.position || undefined,
      },
      {
        onSuccess: (inv) => {
          onClose();
          onCreated(inv);
        },
        onError: (e) => toast.error(e instanceof ApiError ? e.message : '邀请失败'),
      },
    );
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>邀请成员</DialogTitle>
          <DialogDescription>
            生成一条邀请链接，由对方自行设置密码加入 —— 你不需要代设、也不会接触对方密码。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium">邮箱 *</label>
            <Input
              type="email"
              placeholder="member@company.com"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              autoFocus
            />
            <p className="mt-1 text-xs text-fg-muted">
              链接与该邮箱绑定，只有用这个邮箱才能接受邀请。
            </p>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium">角色</label>
            <select
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
              value={form.role}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  role: e.target.value as 'ENTERPRISE_ADMIN' | 'MEMBER',
                }))
              }
            >
              <option value="MEMBER">普通成员</option>
              <option value="ENTERPRISE_ADMIN">企业管理员</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium">部门</label>
            <select
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
              value={form.departmentId}
              onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value }))}
            >
              <option value="">不分配部门</option>
              {flatDepts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium">职位</label>
            <Input
              placeholder="可选，如：高级工程师"
              value={form.position}
              onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={submit} disabled={createInvitation.isPending || !form.email}>
            {createInvitation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            生成邀请链接
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function InvitationPanel({ depts }: { depts: Department[] }) {
  const { data: invitations = [], isLoading } = useInvitations();
  const revokeInvitation = useRevokeInvitation();

  const [inviting, setInviting] = useState(false);
  const [created, setCreated] = useState<CreatedInvitation | null>(null);

  const pendingCount = invitations.filter((i) => i.status === 'PENDING').length;

  const handleRevoke = (inv: EnterpriseInvitation) => {
    revokeInvitation.mutate(inv.id, {
      onSuccess: () => toast.success(`已撤回对 ${inv.email} 的邀请`),
      onError: (e) => toast.error(e instanceof ApiError ? e.message : '撤回失败'),
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-fg-muted">
          {pendingCount > 0 ? `${pendingCount} 条邀请待接受` : '暂无待接受的邀请'}
        </p>
        <Button size="sm" onClick={() => setInviting(true)}>
          <Plus className="h-4 w-4" /> 邀请成员
        </Button>
      </div>

      {isLoading ? (
        <p className="py-8 text-center text-sm text-fg-muted">加载中…</p>
      ) : invitations.length === 0 ? (
        <EmptyState
          icon={<Mail className="h-8 w-8" />}
          title="还没有发出邀请"
          description="生成邀请链接后发给同事，对方自己设密码加入，你无需代设。"
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-background">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-fg-muted">邮箱</th>
                <th className="px-4 py-3 text-left font-medium text-fg-muted">状态</th>
                <th className="px-4 py-3 text-left font-medium text-fg-muted">角色</th>
                <th className="px-4 py-3 text-left font-medium text-fg-muted">部门</th>
                <th className="px-4 py-3 text-left font-medium text-fg-muted">有效期</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {invitations.map((inv) => {
                const meta = STATUS_META[inv.status];
                return (
                  <tr
                    key={inv.id}
                    className={`hover:bg-muted/30 ${inv.status === 'PENDING' ? '' : 'opacity-60'}`}
                  >
                    <td className="px-4 py-3 font-medium">{inv.email}</td>
                    <td className="px-4 py-3">
                      <Badge variant={meta.variant}>{meta.label}</Badge>
                    </td>
                    <td className="px-4 py-3 text-fg-muted">
                      {ROLE_LABEL[inv.role] ?? inv.role}
                    </td>
                    <td className="px-4 py-3 text-fg-muted">
                      {inv.department?.name ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-fg-muted">
                      {inv.status === 'ACCEPTED' && inv.acceptedAt
                        ? `已于 ${formatDistanceToNow(new Date(inv.acceptedAt), {
                            addSuffix: true,
                            locale: zhCN,
                          })}加入`
                        : inv.status === 'PENDING'
                          ? `${formatDistanceToNow(new Date(inv.expiresAt), {
                              addSuffix: true,
                              locale: zhCN,
                            })}过期`
                          : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end">
                        {inv.status === 'PENDING' && (
                          <button
                            title="撤回邀请"
                            onClick={() => handleRevoke(inv)}
                            disabled={revokeInvitation.isPending}
                            className="rounded p-1.5 text-fg-muted hover:bg-danger/10 hover:text-danger disabled:opacity-50"
                          >
                            <XCircle className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="flex items-start gap-1.5 text-xs text-fg-muted">
        <Link2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          邀请链接等同于一次性登录凭证，只在生成时展示一次，请通过可信渠道转达。
          重新邀请同一邮箱会让旧链接立即作废。
        </span>
      </p>

      {inviting && (
        <InviteDialog
          depts={depts}
          onClose={() => setInviting(false)}
          onCreated={setCreated}
        />
      )}

      {created && (
        <InviteLinkReveal invitation={created} onClose={() => setCreated(null)} />
      )}
    </div>
  );
}
