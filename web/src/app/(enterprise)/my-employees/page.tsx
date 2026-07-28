'use client';

import { useState } from 'react';
import Link from 'next/link';
import { MonitorPlay, ShieldCheck, Trash2, Plus, Users, Building2 } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { CenteredSpinner, EmptyState, Spinner } from '@/components/ui/feedback';
import { toast } from '@/components/ui/toast';
import { useAuthStore } from '@/lib/auth-store';
import { ApiError } from '@/lib/api-client';
import {
  useMyEmployees,
  useInstances,
  useInstanceGrants,
  useCreateGrant,
  useDeleteGrant,
  useDepartments,
  useMembers,
} from '@/features/enterprise/use-enterprise';
import type { Department, EmployeeInstance } from '@/lib/types';

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-xl border border-border bg-background shadow-lg">
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <h3 className="text-base font-semibold">{title}</h3>
          <button onClick={onClose} className="text-fg-muted hover:text-foreground">✕</button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

// ── 授权面板（管理员）─────────────────────────────────────────────────────────

function GrantPanel({
  instance,
  onClose,
}: {
  instance: EmployeeInstance;
  onClose: () => void;
}) {
  const { data: grants = [], isLoading } = useInstanceGrants(instance.id);
  const { data: depts = [] } = useDepartments();
  const { data: members = [] } = useMembers();
  const createGrant = useCreateGrant();
  const deleteGrant = useDeleteGrant();

  // 授权对象二选一 —— 后端 refine 强制，前端用单选切换避免用户踩 400
  const [target, setTarget] = useState<'department' | 'member'>('member');
  const [targetId, setTargetId] = useState('');
  const [expiresAt, setExpiresAt] = useState('');

  const flatDepts = flattenDepts(depts);

  const handleAdd = () => {
    if (!targetId) return;
    createGrant.mutate(
      {
        instanceId: instance.id,
        ...(target === 'department'
          ? { departmentId: targetId }
          : { memberId: targetId }),
        // datetime-local 给的是本地时间，转 ISO 交给后端
        ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
      },
      {
        onSuccess: () => {
          toast.success('已开通授权');
          setTargetId('');
          setExpiresAt('');
        },
        onError: (e) => toast.error(e instanceof ApiError ? e.message : '开通失败'),
      },
    );
  };

  return (
    <Modal title={`授权管理 · ${instance.name}`} onClose={onClose}>
      <div className="space-y-5">
        {/* 已有授权 */}
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-fg-subtle">
            已开通
          </p>
          {isLoading ? (
            <Spinner />
          ) : grants.length === 0 ? (
            <p className="rounded border border-dashed border-border px-3 py-4 text-center text-sm text-fg-muted">
              还没有任何授权，下面添加
            </p>
          ) : (
            <div className="space-y-1.5">
              {grants.map((g) => (
                <div
                  key={g.id}
                  className={`flex items-center gap-2 rounded border border-border px-3 py-2 ${
                    g.expired ? 'opacity-50' : ''
                  }`}
                >
                  {g.department ? (
                    <Building2 className="h-3.5 w-3.5 shrink-0 text-fg-muted" />
                  ) : (
                    <Users className="h-3.5 w-3.5 shrink-0 text-fg-muted" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">
                      {g.department
                        ? `${g.department.name}（整个部门）`
                        : g.member?.name || g.member?.email}
                    </p>
                    {g.expiresAt && (
                      <p className="text-xs text-fg-subtle">
                        {g.expired ? '已过期' : '到期'}：
                        {new Date(g.expiresAt).toLocaleString('zh-CN')}
                      </p>
                    )}
                  </div>
                  <button
                    title="收回"
                    onClick={() =>
                      deleteGrant.mutate(
                        { grantId: g.id, instanceId: instance.id },
                        {
                          onSuccess: () => toast.success('已收回'),
                          onError: (e) =>
                            toast.error(e instanceof ApiError ? e.message : '收回失败'),
                        },
                      )
                    }
                    className="rounded p-1 text-fg-muted hover:bg-danger/10 hover:text-danger"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 新增授权 */}
        <div className="space-y-3 border-t border-border pt-4">
          <p className="text-xs font-medium uppercase tracking-wider text-fg-subtle">
            开通新授权
          </p>

          {/* 二选一切换 */}
          <div className="flex gap-1 rounded border border-border p-0.5">
            <button
              onClick={() => { setTarget('member'); setTargetId(''); }}
              className={`flex-1 rounded px-3 py-1.5 text-sm transition-colors ${
                target === 'member'
                  ? 'bg-primary-subtle font-medium text-primary'
                  : 'text-fg-muted hover:bg-muted'
              }`}
            >
              给个人
            </button>
            <button
              onClick={() => { setTarget('department'); setTargetId(''); }}
              className={`flex-1 rounded px-3 py-1.5 text-sm transition-colors ${
                target === 'department'
                  ? 'bg-primary-subtle font-medium text-primary'
                  : 'text-fg-muted hover:bg-muted'
              }`}
            >
              给部门
            </button>
          </div>

          <select
            className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
          >
            <option value="">
              {target === 'member' ? '选择成员…' : '选择部门…'}
            </option>
            {target === 'member'
              ? members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.user.name || m.user.email}
                  </option>
                ))
              : flatDepts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
          </select>

          <div>
            <label className="mb-1 block text-xs font-medium">
              到期时间（留空 = 长期有效）
            </label>
            <Input
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
          </div>

          <Button
            size="sm"
            className="w-full"
            onClick={handleAdd}
            disabled={createGrant.isPending || !targetId}
          >
            <Plus className="h-4 w-4" />
            开通授权
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── 页面 ──────────────────────────────────────────────────────────────────────

export default function MyEmployeesPage() {
  const { roleInEnterprise } = useAuthStore();
  const isAdmin = roleInEnterprise === 'ENTERPRISE_ADMIN';

  const { data: mine = [], isLoading } = useMyEmployees();
  // 管理员才需要实例全表来开授权；普通成员不请求，省一次 403 前的往返
  const { data: instances = [] } = useInstances();
  const [granting, setGranting] = useState<EmployeeInstance | null>(null);

  if (isLoading) return <CenteredSpinner label="加载中…" />;

  return (
    <div className="space-y-8 p-6">
      <div>
        <h1 className="text-2xl font-bold">我的员工</h1>
        <p className="mt-1 text-sm text-fg-muted">
          你被授权使用的硅基员工。停用或过期的不会出现在这里。
        </p>
      </div>

      {mine.length === 0 ? (
        <EmptyState
          icon={<MonitorPlay className="h-8 w-8" />}
          title="还没有可用的员工"
          description={
            isAdmin
              ? '你可以在下方「企业实例」里给自己或部门开通授权。'
              : '请联系企业管理员为你开通授权。'
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {mine.map((e) => (
            <Card key={e.instanceId}>
              <CardContent className="space-y-3 p-5">
                <div className="flex items-start gap-3">
                  <Avatar
                    name={e.template.name}
                    src={e.template.avatar}
                    className="h-10 w-10 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{e.name}</p>
                    <p className="truncate text-xs text-fg-muted">
                      {e.template.name} · v{e.templateVersion}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge
                    className={
                      e.grantSource === 'DIRECT'
                        ? 'bg-primary/10 text-primary'
                        : 'bg-muted text-fg-muted'
                    }
                  >
                    {e.grantSource === 'DIRECT' ? '直接授权' : '部门授权'}
                  </Badge>
                  {e.department && (
                    <Badge className="bg-muted text-fg-muted">
                      {e.department.name}
                    </Badge>
                  )}
                  {e.expiresAt && (
                    <Badge className="bg-warning/10 text-warning">
                      {new Date(e.expiresAt).toLocaleDateString('zh-CN')} 到期
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* 管理员：企业实例 + 授权入口 */}
      {isAdmin && (
        <div className="space-y-3 border-t border-border pt-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <ShieldCheck className="h-4 w-4 text-fg-muted" />
                企业实例
              </h2>
              <p className="mt-0.5 text-sm text-fg-muted">
                管理谁能使用这些员工。授权不影响实例本身的启停。
              </p>
            </div>
            <Link href="/subscriptions">
              <Button variant="secondary" size="sm">管理订阅</Button>
            </Link>
          </div>

          {instances.length === 0 ? (
            <EmptyState
              icon={<MonitorPlay className="h-8 w-8" />}
              title="还没有员工实例"
              description="先在员工市场订阅一位员工，再创建实例。"
              action={
                <Link href="/marketplace">
                  <Button size="sm">前往员工市场</Button>
                </Link>
              }
            />
          ) : (
            <div className="overflow-hidden rounded-lg border border-border bg-background">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-muted/40">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-fg-muted">实例</th>
                    <th className="px-4 py-3 text-left font-medium text-fg-muted">状态</th>
                    <th className="px-4 py-3 text-left font-medium text-fg-muted">部门</th>
                    <th className="px-4 py-3 text-left font-medium text-fg-muted">版本</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {instances.map((inst) => (
                    <tr key={inst.id} className="hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <p className="font-medium">{inst.name}</p>
                        <p className="text-xs text-fg-muted">{inst.template.name}</p>
                      </td>
                      <td className="px-4 py-3">
                        <Badge className={INSTANCE_STATUS_STYLE[inst.status]}>
                          {INSTANCE_STATUS_LABEL[inst.status]}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-fg-muted">
                        {inst.department?.name ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-fg-muted">
                        v{inst.templateVersion}
                        {inst.upgradeAvailable && (
                          <Badge className="ml-1.5 bg-warning/10 text-warning">
                            可升级 v{inst.latestVersion}
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setGranting(inst)}
                          disabled={inst.status === 'REVOKED'}
                        >
                          授权管理
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {granting && (
        <GrantPanel instance={granting} onClose={() => setGranting(null)} />
      )}
    </div>
  );
}

const INSTANCE_STATUS_LABEL: Record<string, string> = {
  PENDING_ACTIVATION: '待激活',
  ACTIVE: '运行中',
  SUSPENDED: '已停用',
  REVOKED: '已回收',
};

const INSTANCE_STATUS_STYLE: Record<string, string> = {
  PENDING_ACTIVATION: 'bg-warning/10 text-warning',
  ACTIVE: 'bg-success/10 text-success',
  SUSPENDED: 'bg-muted text-fg-muted',
  REVOKED: 'bg-danger/10 text-danger',
};

function flattenDepts(
  depts: Department[],
  prefix = '',
): { id: string; label: string }[] {
  const result: { id: string; label: string }[] = [];
  for (const d of depts) {
    const label = prefix ? `${prefix} / ${d.name}` : d.name;
    result.push({ id: d.id, label });
    result.push(...flattenDepts(d.children, label));
  }
  return result;
}
