'use client';

import { useState } from 'react';
import React from 'react';
import Link from 'next/link';
import {
  Plus, MonitorPlay, Pencil, Play, Pause, Trash2, ArrowUpCircle, ShieldCheck,
  Store,
} from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CenteredSpinner, EmptyState } from '@/components/ui/feedback';
import { toast } from '@/components/ui/toast';
import { useAuthStore } from '@/lib/auth-store';
import { ApiError, api } from '@/lib/api-client';
import { useSubscriptions } from '@/features/subscription/use-subscriptions';
import {
  useInstances, useCreateInstance, useUpdateInstance,
  useChangeInstanceStatus, useUpgradeInstance, useDepartments,
} from '@/features/enterprise/use-enterprise';
import { GrantPanel } from '@/features/enterprise/grant-panel';
import { flattenDepts } from '@/features/enterprise/flatten-depts';
import { INSTANCE_STATUS_LABEL, INSTANCE_STATUS_STYLE } from '@/lib/utils';
import { employee as employeeCopy, capability } from '@/locales/zh-CN';
import type { EmployeeInstance, GrantRecord } from '@/lib/types';

function Modal({
  title, onClose, children,
}: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 w-full max-w-sm rounded-xl border border-border bg-background shadow-lg">
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <h3 className="text-base font-semibold">{title}</h3>
          <button onClick={onClose} className="text-fg-muted hover:text-foreground">✕</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export default function InstancesPage() {
  const { roleInEnterprise } = useAuthStore();
  const isAdmin = roleInEnterprise === 'ENTERPRISE_ADMIN';

  const { data: instances = [], isLoading } = useInstances();
  const { data: subs = [] } = useSubscriptions();
  const { data: depts = [] } = useDepartments();
  const createInst = useCreateInstance();
  const updateInst = useUpdateInstance();
  const changeStatus = useChangeInstanceStatus();
  const upgradeInst = useUpgradeInstance();

  const flatDepts = flattenDepts(depts);
  const activeSubs = subs.filter((s) => s.status === 'ACTIVE');

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<EmployeeInstance | null>(null);
  const [granting, setGranting] = useState<EmployeeInstance | null>(null);
  const [revoking, setRevoking] = useState<EmployeeInstance | null>(null);

  // 存储每个实例的授权部门列表
  const [instanceGrants, setInstanceGrants] = useState<Record<string, { deptNames: string[]; memberCount: number }>>({});

  const [newForm, setNewForm] = useState({ templateId: '', name: '', departmentId: '' });
  const [editForm, setEditForm] = useState({ name: '', departmentId: '' as string | null });

  // 异步加载每个实例的授权信息
  React.useEffect(() => {
    if (!instances.length) return;

    instances.forEach(async (inst) => {
      try {
        const grants = await api.get<GrantRecord[]>(`/enterprise/instances/${inst.id}/grants`);
        const deptNames = grants
          .filter(g => g.department && !g.expired)
          .map(g => g.department!.name);
        const memberCount = grants.filter(g => g.member && !g.expired).length;

        setInstanceGrants(prev => ({
          ...prev,
          [inst.id]: { deptNames, memberCount }
        }));
      } catch (e) {
        // 忽略错误，显示默认值
      }
    });
  }, [instances]);

  const handleCreate = () => {
    if (!newForm.templateId || !newForm.name.trim()) return;
    createInst.mutate(
      {
        templateId: newForm.templateId,
        name: newForm.name.trim(),
        departmentId: newForm.departmentId || undefined,
      },
      {
        onSuccess: () => {
          toast.success('硅基员工已配置，上岗后即可授权给碳基员工使用');
          setCreating(false);
          setNewForm({ templateId: '', name: '', departmentId: '' });
        },
        onError: (e) => toast.error(e instanceof ApiError ? e.message : '创建失败'),
      },
    );
  };

  const handleEdit = () => {
    if (!editing) return;
    updateInst.mutate(
      { id: editing.id, name: editForm.name.trim(), departmentId: editForm.departmentId || null },
      {
        onSuccess: () => { toast.success('已更新'); setEditing(null); },
        onError: (e) => toast.error(e instanceof ApiError ? e.message : '更新失败'),
      },
    );
  };

  const setStatus = (inst: EmployeeInstance, status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED') => {
    changeStatus.mutate(
      { id: inst.id, status },
      {
        onSuccess: (r) => {
          toast.success(
            r.changed
              ? `「${inst.name}」已${INSTANCE_STATUS_LABEL[status]}`
              : '状态未变化',
          );
          setRevoking(null);
        },
        onError: (e) => toast.error(e instanceof ApiError ? e.message : '操作失败'),
      },
    );
  };


  const handleUpgrade = (inst: EmployeeInstance) => {
    upgradeInst.mutate(inst.id, {
      onSuccess: (r) =>
        toast.success(
          `已从 v${r.from} 升级到 v${r.to}` +
            (r.configReviewRequired ? '，请复核配置（未自动迁移）' : ''),
        ),
      onError: (e) => toast.error(e instanceof ApiError ? e.message : '升级失败'),
    });
  };

  if (isLoading) return <CenteredSpinner label="加载中…" />;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{employeeCopy.grantConfig}</h1>
          <p className="mt-1 text-sm text-fg-muted">
            一位硅基员工可在不同部门分别上岗。暂停不会删除授权，恢复后原授权继续有效。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/marketplace">
            <Button variant="outline" size="sm">
              <Store className="h-4 w-4" /> {employeeCopy.market}
            </Button>
          </Link>
          {isAdmin && (
            <Button
              size="sm"
              onClick={() => setCreating(true)}
              disabled={activeSubs.length === 0}
              title={activeSubs.length === 0 ? `需先在${employeeCopy.market}招聘硅基员工` : undefined}
            >
              <Plus className="h-4 w-4" /> {employeeCopy.addUnit}
            </Button>
          )}
        </div>
      </div>

      {instances.length === 0 ? (
        <EmptyState
          icon={<MonitorPlay className="h-8 w-8" />}
          title="还没有可授权的硅基员工"
          description={
            activeSubs.length === 0
              ? '先在硅基人才市场招聘一位硅基员工，再回来配置授权。'
              : isAdmin
                ? '你已雇佣硅基员工，配置后即可授权给部门或碳基员工。'
                : '请联系企业管理员配置硅基员工。'
          }
          action={
            activeSubs.length === 0 ? (
              <Link href="/marketplace"><Button size="sm">前往硅基人才市场</Button></Link>
            ) : isAdmin ? (
              <Button size="sm" onClick={() => setCreating(true)}>{employeeCopy.addUnit}</Button>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-background">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-fg-muted">硅基员工</th>
                <th className="px-4 py-3 text-left font-medium text-fg-muted">状态</th>
                <th className="px-4 py-3 text-left font-medium text-fg-muted">部门</th>
                <th className="px-4 py-3 text-left font-medium text-fg-muted">版本</th>
                {isAdmin && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {instances.map((inst) => {
                const revoked = inst.status === 'REVOKED';
                return (
                  <tr key={inst.id} className={revoked ? 'opacity-50' : 'hover:bg-muted/30'}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar
                          name={inst.template.name}
                          src={inst.template.avatar}
                          className="h-8 w-8 shrink-0 text-xs"
                        />
                        <div>
                          <p className="font-medium">{inst.name}</p>
                          <p className="text-xs text-fg-muted">{inst.template.name}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={INSTANCE_STATUS_STYLE[inst.status]}>
                        {INSTANCE_STATUS_LABEL[inst.status]}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-fg-muted">
                      {instanceGrants[inst.id]?.deptNames.length > 0
                        ? instanceGrants[inst.id].deptNames.join(', ')
                        : '—'}
                      {instanceGrants[inst.id]?.memberCount > 0 && ` +${instanceGrants[inst.id].memberCount}人`}
                    </td>
                    <td className="px-4 py-3 text-fg-muted">
                      v{inst.templateVersion}
                      {inst.upgradeAvailable && !revoked && (
                        <Badge className="ml-1.5 bg-warning/10 text-warning">
                          可升 v{inst.latestVersion}
                        </Badge>
                      )}
                    </td>
                    {isAdmin && (
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {inst.upgradeAvailable && !revoked && (
                            <button
                              title={`升级到 v${inst.latestVersion}`}
                              onClick={() => handleUpgrade(inst)}
                              disabled={upgradeInst.isPending}
                              className="rounded p-1.5 text-warning hover:bg-warning/10"
                            >
                              <ArrowUpCircle className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {inst.status === 'ACTIVE' ? (
                            <button
                              title={employeeCopy.pause}
                              onClick={() => setStatus(inst, 'SUSPENDED')}
                              className="rounded p-1.5 text-fg-muted hover:bg-muted hover:text-foreground"
                            >
                              <Pause className="h-3.5 w-3.5" />
                            </button>
                          ) : !revoked ? (
                            <button
                              title={employeeCopy.onboard}
                              onClick={() => setStatus(inst, 'ACTIVE')}
                              className="rounded p-1.5 text-success hover:bg-success/10"
                            >
                              <Play className="h-3.5 w-3.5" />
                            </button>
                          ) : null}
                          <button
                            title="授权管理"
                            onClick={() => setGranting(inst)}
                            disabled={revoked}
                            className="rounded p-1.5 text-fg-muted hover:bg-primary-subtle hover:text-primary disabled:opacity-40"
                          >
                            <ShieldCheck className="h-3.5 w-3.5" />
                          </button>
                          <button
                            title="改名 / 换部门"
                            onClick={() => {
                              setEditing(inst);
                              setEditForm({ name: inst.name, departmentId: inst.department?.id ?? null });
                            }}
                            disabled={revoked}
                            className="rounded p-1.5 text-fg-muted hover:bg-muted hover:text-foreground disabled:opacity-40"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            title={`${employeeCopy.dismiss}（不可撤销）`}
                            onClick={() => setRevoking(inst)}
                            disabled={revoked}
                            className="rounded p-1.5 text-fg-muted hover:bg-danger/10 hover:text-danger disabled:opacity-40"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 新增硅基员工 */}
      {creating && (
        <Modal title={employeeCopy.addUnit} onClose={() => setCreating(false)}>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium">硅基员工 *</label>
              <select
                className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
                value={newForm.templateId}
                onChange={(e) => setNewForm((f) => ({ ...f, templateId: e.target.value }))}
              >
                <option value="">选择已雇佣的硅基员工…</option>
                {activeSubs.map((s) => (
                  <option key={s.employee.id} value={s.employee.id}>{s.employee.name}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-fg-subtle">
                只列出雇佣关系生效中的硅基人才。同一位可配置多个，分别授权给不同部门。
              </p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">员工名称 *</label>
              <Input
                placeholder="如：技术部文案助手"
                value={newForm.name}
                onChange={(e) => setNewForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">归属部门</label>
              <select
                className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
                value={newForm.departmentId}
                onChange={(e) => setNewForm((f) => ({ ...f, departmentId: e.target.value }))}
              >
                <option value="">不指定</option>
                {flatDepts.map((d) => (
                  <option key={d.id} value={d.id}>{d.label}</option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" size="sm" onClick={() => setCreating(false)}>取消</Button>
              <Button
                size="sm"
                onClick={handleCreate}
                disabled={createInst.isPending || !newForm.templateId || !newForm.name.trim()}
              >
                创建
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* 编辑 */}
      {editing && (
        <Modal title={`编辑 · ${editing.name}`} onClose={() => setEditing(null)}>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium">员工名称</label>
              <Input
                value={editForm.name}
                onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">归属部门</label>
              <select
                className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
                value={editForm.departmentId ?? ''}
                onChange={(e) => setEditForm((f) => ({ ...f, departmentId: e.target.value || null }))}
              >
                <option value="">不指定</option>
                {flatDepts.map((d) => (
                  <option key={d.id} value={d.id}>{d.label}</option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>取消</Button>
              <Button size="sm" onClick={handleEdit} disabled={updateInst.isPending}>保存</Button>
            </div>
          </div>
        </Modal>
      )}

      {/* 解聘确认 */}
      {revoking && (
        <Modal title={employeeCopy.dismiss} onClose={() => setRevoking(null)}>
          <div className="space-y-4">
            <p className="text-sm text-fg-muted">
              确定解聘{' '}
              <span className="font-medium text-foreground">{revoking.name}</span>？
              <br />
              解聘是<span className="font-medium text-danger">终态，不可撤销</span> ——
              之后无法重新上岗。若只是暂时不用，请改用「暂停工作」。
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setRevoking(null)}>取消</Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => setStatus(revoking, 'REVOKED')}
                disabled={changeStatus.isPending}
              >
                确认解聘
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {granting && (
        <GrantPanel instance={granting} onClose={() => setGranting(null)} />
      )}
    </div>
  );
}
