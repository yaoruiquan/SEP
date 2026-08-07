'use client';

import { useState } from 'react';
import {
  Plus, Pencil, Trash2, ChevronRight, ChevronDown,
  Users, Crown, UserMinus, UserPlus, Building2, Settings2, Check,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { CenteredSpinner, EmptyState } from '@/components/ui/feedback';
import { toast } from '@/components/ui/toast';
import { useAuthStore } from '@/lib/auth-store';
import { ApiError } from '@/lib/api-client';
import {
  useDepartments,
  useCreateDepartment,
  useUpdateDepartment,
  useDeleteDepartment,
} from '@/features/enterprise/use-enterprise';
import {
  useDeptMembers,
  useRemoveDeptMember,
  useSetDeptLeader,
} from '@/features/enterprise/use-department-members';
import { AddMembersDialog } from '@/features/enterprise/add-members-dialog';
import {
  useAvailableModels,
  useDepartmentPolicy,
  useSetDepartmentPolicy,
} from '@/features/enterprise-settings/use-model-config';
import type { Department, DeptMemberItem } from '@/lib/types';

// ── Modal ────────────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: {
  title: string; onClose: () => void; children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 w-full max-w-sm rounded-xl border border-border bg-background shadow-lg">
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <h3 className="text-base font-semibold">{title}</h3>
          <button onClick={onClose} className="text-lg text-fg-muted hover:text-foreground">✕</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

// ── 部门树节点 ────────────────────────────────────────────────────────────────

function DeptNode({
  dept, depth, isAdmin, selectedId, onSelect, onRename, onDelete, onAddChild,
}: {
  dept: Department; depth: number; isAdmin: boolean; selectedId: string | null;
  onSelect: (id: string) => void; onRename: (d: Department) => void;
  onDelete: (d: Department) => void; onAddChild: (parentId: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = dept.children.length > 0;
  const isSelected = selectedId === dept.id;

  return (
    <div>
      <div
        className={[
          'group flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 transition-colors',
          isSelected ? 'bg-primary/10' : 'hover:bg-muted',
        ].join(' ')}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => onSelect(dept.id)}
      >
        <button
          onClick={(e) => { e.stopPropagation(); hasChildren && setExpanded(!expanded); }}
          className="flex h-5 w-5 shrink-0 items-center justify-center text-fg-muted"
        >
          {hasChildren
            ? expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />
            : <span className="w-4" />}
        </button>

        <span className={[
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
          isSelected ? 'bg-primary/20 text-primary' : 'bg-muted text-fg-muted',
        ].join(' ')}>
          {hasChildren ? (
            <Building2 className="h-3.5 w-3.5" />
          ) : (
            <Users className="h-3.5 w-3.5" />
          )}
        </span>

        <span className={[
          'flex-1 truncate text-sm',
          depth === 0 ? 'font-semibold' : 'font-medium',
          isSelected ? 'text-primary' : '',
        ].join(' ')}>
          {dept.name}
        </span>

        {typeof dept._count?.members === 'number' && (
          <span className={[
            'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums',
            isSelected ? 'bg-primary/20 text-primary' : 'bg-muted text-fg-muted',
          ].join(' ')}>
            {dept._count.members}
          </span>
        )}

        {isAdmin && (
          <div className="hidden shrink-0 items-center group-hover:flex" onClick={(e) => e.stopPropagation()}>
            <button title="添加子部门" onClick={() => onAddChild(dept.id)}
              className="flex h-7 w-7 items-center justify-center rounded text-fg-muted hover:bg-background hover:text-primary">
              <Plus className="h-3.5 w-3.5" />
            </button>
            <button title="重命名" onClick={() => onRename(dept)}
              className="flex h-7 w-7 items-center justify-center rounded text-fg-muted hover:bg-background hover:text-primary">
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button title="删除" onClick={() => onDelete(dept)}
              className="flex h-7 w-7 items-center justify-center rounded text-fg-muted hover:bg-background hover:text-danger">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {expanded && dept.children.map((child) => (
        <DeptNode key={child.id} dept={child} depth={depth + 1} isAdmin={isAdmin}
          selectedId={selectedId} onSelect={onSelect} onRename={onRename}
          onDelete={onDelete} onAddChild={onAddChild} />
      ))}
    </div>
  );
}

// ── 成员面板 ──────────────────────────────────────────────────────────────────

function MembersPanel({ dept, isAdmin }: { dept: Department | null; isAdmin: boolean }) {
  const [showAdd, setShowAdd] = useState(false);
  const { data, isLoading } = useDeptMembers(dept?.id ?? '', undefined);
  const removeMember = useRemoveDeptMember(dept?.id ?? '');
  const setLeader = useSetDeptLeader(dept?.id ?? '');

  const leaderId = data?.leaderId ?? null;
  const items = data?.items ?? [];

  if (!dept) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <EmptyState
          icon={<Users className="h-10 w-10 text-fg-muted" />}
          title="选择一个部门"
          description="点击左侧任意部门，在这里查看并管理其成员。"
        />
      </div>
    );
  }

  const handleRemove = (m: DeptMemberItem) => {
    if (!confirm(`确定将「${m.user.name ?? m.user.email}」移出部门？`)) return;
    removeMember.mutate(m.id, {
      onSuccess: () => toast.success('已移出部门'),
      onError: (e) => toast.error(e instanceof ApiError ? e.message : '操作失败'),
    });
  };

  const handleSetLeader = (memberId: string) => {
    setLeader.mutate(memberId, {
      onSuccess: () => toast.success('已设置主管'),
      onError: (e) => toast.error(e instanceof ApiError ? e.message : '操作失败'),
    });
  };

  const handleClearLeader = () => {
    setLeader.mutate(null, {
      onSuccess: () => toast.success('已取消主管'),
      onError: (e) => toast.error(e instanceof ApiError ? e.message : '操作失败'),
    });
  };

  const leaderMember = items.find((m) => m.id === leaderId);

  return (
    <div className="flex h-full flex-col">
      {/* 面板 header */}
      <div className="flex items-start justify-between border-b border-border px-6 py-4">
        <div>
          <h2 className="text-lg font-bold">{dept.name}</h2>
          <p className="mt-0.5 text-sm text-fg-muted">
            {data ? `${data.total} 位成员` : '—'}
            {leaderMember && (
              <> · 主管：<span className="font-medium text-foreground">
                {leaderMember.user.name ?? leaderMember.user.email}
              </span></>
            )}
          </p>
        </div>
        {isAdmin && (
          <Button onClick={() => setShowAdd(true)}>
            <UserPlus className="h-4 w-4" />
            添加成员
          </Button>
        )}
      </div>

      {/* 成员列表 */}
      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <CenteredSpinner label="加载中…" />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Users className="h-8 w-8 text-fg-muted" />}
            title="暂无成员"
            description={isAdmin ? '点击「添加成员」将企业成员加入此部门。' : '此部门还没有成员。'}
            action={isAdmin ? (
              <Button size="sm" onClick={() => setShowAdd(true)}>
                <UserPlus className="h-4 w-4" /> 添加成员
              </Button>
            ) : undefined}
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((m) => <MemberCard key={m.id} member={m} isLeader={m.id === leaderId}
              isAdmin={isAdmin} onSetLeader={() => handleSetLeader(m.id)}
              onClearLeader={handleClearLeader} onRemove={() => handleRemove(m)}
              settingLeader={setLeader.isPending} removing={removeMember.isPending} />)}
          </div>
        )}
      </div>

      {showAdd && <AddMembersDialog deptId={dept.id} deptName={dept.name} onClose={() => setShowAdd(false)} />}
    </div>
  );
}

// ── 成员卡片 ──────────────────────────────────────────────────────────────────

function MemberCard({
  member, isLeader, isAdmin, onSetLeader, onClearLeader, onRemove, settingLeader, removing,
}: {
  member: DeptMemberItem; isLeader: boolean; isAdmin: boolean;
  onSetLeader: () => void; onClearLeader: () => void; onRemove: () => void;
  settingLeader: boolean; removing: boolean;
}) {
  const name = member.user.name ?? member.user.email;
  const initials = name[0].toUpperCase();

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4 transition-shadow hover:shadow-sm">
      {/* top row: avatar + name */}
      <div className="flex items-center gap-3">
        <div className="relative shrink-0">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/15 text-sm font-bold text-primary">
            {initials}
          </span>
          {isLeader && (
            <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-amber-400">
              <Crown className="h-2.5 w-2.5 text-white" />
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{name}</p>
          <p className="truncate text-xs text-fg-muted">{member.user.email}</p>
        </div>
      </div>

      {/* badges row */}
      <div className="flex flex-wrap items-center gap-1.5">
        {isLeader && (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-400">
            部门主管
          </span>
        )}
        <Badge className={member.role === 'ENTERPRISE_ADMIN' ? 'bg-primary/10 text-primary' : 'bg-muted text-fg-muted'}>
          {member.role === 'ENTERPRISE_ADMIN' ? '企业管理员' : '成员'}
        </Badge>
        {member.position && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-fg-muted">{member.position}</span>
        )}
      </div>

      {/* action row */}
      {isAdmin && (
        <div className="flex gap-1.5 border-t border-border pt-2.5">
          {isLeader ? (
            <Button variant="ghost" size="sm" onClick={onClearLeader} disabled={settingLeader}
              className="h-7 flex-1 px-2 text-xs text-fg-muted">
              取消主管
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={onSetLeader} disabled={settingLeader}
              className="h-7 flex-1 px-2 text-xs">
              <Crown className="mr-1 h-3 w-3 text-amber-500" /> 设为主管
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onRemove} disabled={removing}
            className="h-7 flex-1 px-2 text-xs text-danger hover:bg-danger/10">
            <UserMinus className="mr-1 h-3 w-3" /> 移出
          </Button>
        </div>
      )}
    </div>
  );
}

// ── 部门模型策略面板 ──────────────────────────────────────────────────────────

function ModelPolicyPanel({
  dept,
  isAdmin,
  enterpriseId,
}: {
  dept: Department | null;
  isAdmin: boolean;
  enterpriseId: string;
}) {
  const { data: policy, isLoading: loadingPolicy } = useDepartmentPolicy(dept?.id ?? null);
  const { data: availableModels, isLoading: loadingModels } = useAvailableModels(enterpriseId);
  const setPolicy = useSetDepartmentPolicy(dept?.id ?? '');

  // 本地编辑状态
  const [defaultModel, setDefaultModel] = useState<string>('');
  const [allowedModels, setAllowedModels] = useState<string[]>([]);
  const [initialized, setInitialized] = useState(false);

  // 用服务端数据初始化本地状态（dept 切换时重置）
  const deptId = dept?.id;
  const policyLoaded = !loadingPolicy && policy !== undefined;

  // 每当 dept 切换或 policy 加载完成时同步
  if (policyLoaded && !initialized) {
    setDefaultModel(policy?.defaultChatModel ?? '');
    setAllowedModels(policy?.allowedChatModels ?? []);
    setInitialized(true);
  }

  // dept 切换时重置 initialized
  const [prevDeptId, setPrevDeptId] = useState<string | undefined>(deptId);
  if (deptId !== prevDeptId) {
    setPrevDeptId(deptId);
    setInitialized(false);
  }

  if (!dept) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <EmptyState
          icon={<Settings2 className="h-10 w-10 text-fg-muted" />}
          title="选择一个部门"
          description="点击左侧任意部门，在这里查看并配置其模型策略。"
        />
      </div>
    );
  }

  const isLoading = loadingPolicy || loadingModels;

  const toggleModel = (modelId: string) => {
    setAllowedModels((prev) =>
      prev.includes(modelId) ? prev.filter((m) => m !== modelId) : [...prev, modelId],
    );
  };

  const handleSave = () => {
    setPolicy.mutate(
      {
        defaultChatModel: defaultModel || null,
        allowedChatModels: allowedModels,
      },
      {
        onSuccess: () => toast.success('模型策略已保存'),
        onError: (e) => toast.error(e instanceof ApiError ? e.message : '保存失败'),
      },
    );
  };

  return (
    <div className="flex h-full flex-col">
      {/* 面板 header */}
      <div className="border-b border-border px-6 py-4">
        <h2 className="text-lg font-bold">{dept.name}</h2>
        <p className="mt-0.5 text-sm text-fg-muted">为此部门配置独立的模型策略（覆盖企业全局配置）</p>
      </div>

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <CenteredSpinner label="加载中…" />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-6">
          <div className="mx-auto max-w-lg space-y-6">

            {/* 默认模型 */}
            <section className="space-y-2">
              <label className="text-sm font-semibold">默认模型</label>
              <p className="text-xs text-fg-muted">
                未设置时继承企业全局默认模型。
              </p>
              <select
                value={defaultModel}
                onChange={(e) => setDefaultModel(e.target.value)}
                disabled={!isAdmin}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
              >
                <option value="">— 继承企业配置 —</option>
                {(availableModels ?? []).map((m) => (
                  <option key={m.modelId} value={m.modelId}>
                    {m.label}
                    {m.vendor ? ` (${m.vendor})` : ''}
                  </option>
                ))}
              </select>
            </section>

            {/* 模型白名单 */}
            <section className="space-y-2">
              <label className="text-sm font-semibold">可用模型白名单</label>
              <p className="text-xs text-fg-muted">
                勾选后仅允许部门成员选择这些模型。不勾选任何选项则继承企业全局白名单。
              </p>
              {(availableModels ?? []).length === 0 ? (
                <p className="text-xs text-fg-muted">暂无可用模型，请先在「系统设置」中启用模型。</p>
              ) : (
                <div className="space-y-1 rounded-lg border border-border bg-bg-subtle p-3">
                  {(availableModels ?? []).map((m) => {
                    const checked = allowedModels.includes(m.modelId);
                    return (
                      <label
                        key={m.modelId}
                        className={`flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-background ${
                          !isAdmin ? 'pointer-events-none' : ''
                        }`}
                      >
                        <span
                          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                            checked
                              ? 'border-primary bg-primary'
                              : 'border-border bg-background'
                          }`}
                        >
                          {checked && <Check className="h-2.5 w-2.5 text-white" />}
                        </span>
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={checked}
                          onChange={() => isAdmin && toggleModel(m.modelId)}
                          disabled={!isAdmin}
                        />
                        <div className="min-w-0 flex-1">
                          <span className="text-sm font-medium">{m.label}</span>
                          {m.vendor && (
                            <span className="ml-1.5 text-xs text-fg-muted">
                              {m.vendor}
                              {m.category ? ` · ${m.category}` : ''}
                            </span>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </section>

            {/* 保存按钮 */}
            {isAdmin && (
              <div className="flex justify-end pt-2">
                <Button onClick={handleSave} disabled={setPolicy.isPending}>
                  {setPolicy.isPending ? '保存中…' : '保存策略'}
                </Button>
              </div>
            )}

            {!isAdmin && (
              <p className="text-xs text-fg-subtle">仅企业管理员可修改模型策略。</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── 页面 ──────────────────────────────────────────────────────────────────────

export default function DepartmentsPage() {
  const { roleInEnterprise, enterprise } = useAuthStore();
  const isAdmin = roleInEnterprise === 'ENTERPRISE_ADMIN';
  const enterpriseId = enterprise?.id ?? '';

  const { data: depts = [], isLoading, isError, error } = useDepartments();
  const createDept = useCreateDepartment();
  const updateDept = useUpdateDepartment();
  const deleteDept = useDeleteDepartment();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rightTab, setRightTab] = useState<'members' | 'model-policy'>('members');
  const [creating, setCreating] = useState<{ parentId?: string } | null>(null);
  const [renaming, setRenaming] = useState<Department | null>(null);
  const [deleting, setDeleting] = useState<Department | null>(null);
  const [draftName, setDraftName] = useState('');

  const selectedDept = selectedId ? findDept(depts, selectedId) ?? null : null;

  const handleCreate = () => {
    if (!draftName.trim()) return;
    createDept.mutate(
      { name: draftName.trim(), parentId: creating?.parentId },
      {
        onSuccess: () => { toast.success('部门已创建'); setCreating(null); setDraftName(''); },
        onError: (e) => toast.error(e instanceof ApiError ? e.message : '创建失败'),
      },
    );
  };

  const handleRename = () => {
    if (!renaming || !draftName.trim()) return;
    updateDept.mutate(
      { id: renaming.id, name: draftName.trim() },
      {
        onSuccess: () => { toast.success('已重命名'); setRenaming(null); setDraftName(''); },
        onError: (e) => toast.error(e instanceof ApiError ? e.message : '重命名失败'),
      },
    );
  };

  const handleDelete = () => {
    if (!deleting) return;
    deleteDept.mutate(deleting.id, {
      onSuccess: () => {
        toast.success('已删除');
        setDeleting(null);
        if (selectedId === deleting.id) setSelectedId(null);
      },
      onError: (e) => toast.error(e instanceof ApiError ? e.message : '删除失败（请先清空子部门和成员）'),
    });
  };

  if (isLoading) return <CenteredSpinner label="加载中…" />;
  if (isError) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <EmptyState
          icon={<Building2 className="h-8 w-8" />}
          title="加载失败"
          description={error?.message ?? '无法加载部门列表，请稍后重试。'}
          action={<Button size="sm" onClick={() => window.location.reload()}>刷新页面</Button>}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* 页面 header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <h1 className="text-xl font-bold">部门管理</h1>
          <p className="mt-0.5 text-sm text-fg-muted">管理企业组织架构与部门成员</p>
        </div>
        {isAdmin && (
          <Button size="sm" onClick={() => { setCreating({}); setDraftName(''); }}>
            <Plus className="h-4 w-4" /> 新建顶级部门
          </Button>
        )}
      </div>

      {/* 分栏主体 */}
      <div className="flex min-h-0 flex-1">
        {/* 左：部门树 */}
        <div className="w-72 shrink-0 overflow-y-auto border-r border-border p-3">
          {depts.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <Building2 className="h-8 w-8 text-fg-muted" />
              <p className="text-sm text-fg-muted">{isAdmin ? '还没有部门，先创建一个吧。' : '企业还没有部门。'}</p>
              {isAdmin && (
                <Button size="sm" onClick={() => { setCreating({}); setDraftName(''); }}>新建部门</Button>
              )}
            </div>
          ) : (
            depts.map((d) => (
              <DeptNode
                key={d.id} dept={d} depth={0} isAdmin={isAdmin}
                selectedId={selectedId} onSelect={setSelectedId}
                onRename={(dept) => { setRenaming(dept); setDraftName(dept.name); }}
                onDelete={(dept) => setDeleting(dept)}
                onAddChild={(parentId) => { setCreating({ parentId }); setDraftName(''); }}
              />
            ))
          )}
        </div>

        {/* 右：标签面板（成员 / 模型策略） */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* 标签栏 — 仅在选中部门时显示 */}
          {selectedDept && (
            <div className="flex shrink-0 border-b border-border px-6">
              {([
                { key: 'members', label: '成员', icon: <Users className="h-3.5 w-3.5" /> },
                { key: 'model-policy', label: '模型策略', icon: <Settings2 className="h-3.5 w-3.5" /> },
              ] as const).map(({ key, label, icon }) => (
                <button
                  key={key}
                  onClick={() => setRightTab(key)}
                  className={[
                    'flex items-center gap-1.5 border-b-2 px-1 py-3 text-sm font-medium transition-colors mr-6',
                    rightTab === key
                      ? 'border-primary text-primary'
                      : 'border-transparent text-fg-muted hover:text-foreground',
                  ].join(' ')}
                >
                  {icon}
                  {label}
                </button>
              ))}
            </div>
          )}

          <div className="min-h-0 flex-1">
            {rightTab === 'members' || !selectedDept ? (
              <MembersPanel dept={selectedDept} isAdmin={isAdmin} />
            ) : (
              <ModelPolicyPanel
                dept={selectedDept}
                isAdmin={isAdmin}
                enterpriseId={enterpriseId}
              />
            )}
          </div>
        </div>
      </div>

      {/* Modals */}
      {creating !== null && (
        <Modal title={creating.parentId ? '添加子部门' : '新建顶级部门'} onClose={() => setCreating(null)}>
          <div className="space-y-4">
            <Input placeholder="部门名称" value={draftName} onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()} autoFocus />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setCreating(null)}>取消</Button>
              <Button size="sm" onClick={handleCreate} disabled={createDept.isPending || !draftName.trim()}>创建</Button>
            </div>
          </div>
        </Modal>
      )}
      {renaming !== null && (
        <Modal title="重命名部门" onClose={() => setRenaming(null)}>
          <div className="space-y-4">
            <Input value={draftName} onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleRename()} autoFocus />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setRenaming(null)}>取消</Button>
              <Button size="sm" onClick={handleRename} disabled={updateDept.isPending || !draftName.trim()}>保存</Button>
            </div>
          </div>
        </Modal>
      )}
      {deleting !== null && (
        <Modal title="删除部门" onClose={() => setDeleting(null)}>
          <div className="space-y-4">
            <p className="text-sm text-fg-muted">
              确定删除部门 <span className="font-medium text-foreground">「{deleting.name}」</span>？
              删除前需先清空其子部门和成员。
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setDeleting(null)}>取消</Button>
              <Button variant="danger" size="sm" onClick={handleDelete} disabled={deleteDept.isPending}>确认删除</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── 工具函数 ─────────────────────────────────────────────────────────────────

function findDept(depts: Department[], id: string): Department | undefined {
  for (const d of depts) {
    if (d.id === id) return d;
    const found = findDept(d.children, id);
    if (found) return found;
  }
  return undefined;
}