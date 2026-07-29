'use client';

import { useState } from 'react';
import { Plus, Pencil, Trash2, Users } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CenteredSpinner, EmptyState } from '@/components/ui/feedback';
import { toast } from '@/components/ui/toast';
import { useAuthStore } from '@/lib/auth-store';
import { ApiError } from '@/lib/api-client';
import {
  useMembers,
  useDepartments,
  useCreateMember,
  useUpdateMember,
  useDeleteMember,
} from '@/features/enterprise/use-enterprise';
import { flattenDepts } from '@/features/enterprise/flatten-depts';
import type { EnterpriseMember } from '@/lib/types';

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

const ROLE_LABEL: Record<string, string> = {
  ENTERPRISE_ADMIN: '企业管理员',
  DEPT_MANAGER: '部门负责人',
  MEMBER: '普通成员',
};

export default function MembersPage() {
  const { roleInEnterprise } = useAuthStore();
  const isAdmin = roleInEnterprise === 'ENTERPRISE_ADMIN';

  const { data: members = [], isLoading } = useMembers();
  const { data: depts = [] } = useDepartments();
  const createMember = useCreateMember();
  const updateMember = useUpdateMember();
  const deleteMember = useDeleteMember();

  // 扁平化部门列表（用于下拉）
  const flatDepts = flattenDepts(depts);

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<EnterpriseMember | null>(null);
  const [removing, setRemoving] = useState<EnterpriseMember | null>(null);

  // 新建表单
  const [newForm, setNewForm] = useState({
    email: '', password: '', name: '', role: 'MEMBER' as 'ENTERPRISE_ADMIN' | 'MEMBER',
    departmentId: '', position: '',
  });

  // 编辑表单
  const [editForm, setEditForm] = useState({
    role: 'MEMBER' as 'ENTERPRISE_ADMIN' | 'MEMBER',
    departmentId: '' as string | null,
    position: '' as string | null,
  });

  const handleAdd = () => {
    if (!newForm.email || !newForm.password) return;
    createMember.mutate(
      {
        email: newForm.email,
        password: newForm.password,
        name: newForm.name || undefined,
        role: newForm.role,
        departmentId: newForm.departmentId || undefined,
        position: newForm.position || undefined,
      },
      {
        onSuccess: () => {
          toast.success('成员已添加');
          setAdding(false);
          setNewForm({ email: '', password: '', name: '', role: 'MEMBER', departmentId: '', position: '' });
        },
        onError: (e) => toast.error(e instanceof ApiError ? e.message : '添加失败'),
      },
    );
  };

  const handleEdit = () => {
    if (!editing) return;
    updateMember.mutate(
      {
        id: editing.id,
        role: editForm.role,
        departmentId: editForm.departmentId || null,
        position: editForm.position || null,
      },
      {
        onSuccess: () => { toast.success('已更新'); setEditing(null); },
        onError: (e) => toast.error(e instanceof ApiError ? e.message : '更新失败'),
      },
    );
  };

  const handleRemove = () => {
    if (!removing) return;
    deleteMember.mutate(removing.id, {
      onSuccess: () => { toast.success('已移出企业'); setRemoving(null); },
      onError: (e) => toast.error(e instanceof ApiError ? e.message : '移出失败'),
    });
  };

  if (isLoading) return <CenteredSpinner label="加载中…" />;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">成员管理</h1>
          <p className="mt-1 text-sm text-fg-muted">共 {members.length} 名成员</p>
        </div>
        {isAdmin && (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> 添加成员
          </Button>
        )}
      </div>

      {members.length === 0 ? (
        <EmptyState icon={<Users className="h-8 w-8" />} title="还没有成员" />
      ) : (
        <div className="rounded-lg border border-border bg-background overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-fg-muted">成员</th>
                <th className="px-4 py-3 text-left font-medium text-fg-muted">角色</th>
                <th className="px-4 py-3 text-left font-medium text-fg-muted">部门</th>
                <th className="px-4 py-3 text-left font-medium text-fg-muted">职位</th>
                {isAdmin && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {members.map((m) => (
                <tr key={m.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <Avatar
                        name={m.user.name || m.user.email}
                        src={m.user.avatar}
                        className="h-8 w-8 shrink-0 text-xs"
                      />
                      <div>
                        <p className="font-medium">{m.user.name || '—'}</p>
                        <p className="text-xs text-fg-muted">{m.user.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge className={
                      m.role === 'ENTERPRISE_ADMIN'
                        ? 'bg-primary/10 text-primary'
                        : 'bg-muted text-fg-muted'
                    }>
                      {ROLE_LABEL[m.role] ?? m.role}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-fg-muted">{m.department?.name ?? '—'}</td>
                  <td className="px-4 py-3 text-fg-muted">{m.position ?? '—'}</td>
                  {isAdmin && (
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          title="编辑"
                          onClick={() => {
                            setEditing(m);
                            setEditForm({
                              role: (m.role === 'ENTERPRISE_ADMIN' ? 'ENTERPRISE_ADMIN' : 'MEMBER'),
                              departmentId: m.department?.id ?? null,
                              position: m.position,
                            });
                          }}
                          className="rounded p-1.5 text-fg-muted hover:bg-muted hover:text-foreground"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          title="移出企业"
                          onClick={() => setRemoving(m)}
                          className="rounded p-1.5 text-fg-muted hover:bg-danger/10 hover:text-danger"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 添加成员 */}
      {adding && (
        <Modal title="添加成员" onClose={() => setAdding(false)}>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium">邮箱 *</label>
              <Input
                type="email"
                placeholder="member@company.com"
                value={newForm.email}
                onChange={(e) => setNewForm((f) => ({ ...f, email: e.target.value }))}
                autoFocus
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">初始密码 *</label>
              <Input
                type="password"
                placeholder="至少 8 位"
                value={newForm.password}
                onChange={(e) => setNewForm((f) => ({ ...f, password: e.target.value }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">姓名</label>
              <Input
                placeholder="可选"
                value={newForm.name}
                onChange={(e) => setNewForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">角色</label>
              <select
                className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
                value={newForm.role}
                onChange={(e) => setNewForm((f) => ({ ...f, role: e.target.value as 'ENTERPRISE_ADMIN' | 'MEMBER' }))}
              >
                <option value="MEMBER">普通成员</option>
                <option value="ENTERPRISE_ADMIN">企业管理员</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">部门</label>
              <select
                className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
                value={newForm.departmentId}
                onChange={(e) => setNewForm((f) => ({ ...f, departmentId: e.target.value }))}
              >
                <option value="">不分配部门</option>
                {flatDepts.map((d) => (
                  <option key={d.id} value={d.id}>{d.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">职位</label>
              <Input
                placeholder="可选，如：高级工程师"
                value={newForm.position}
                onChange={(e) => setNewForm((f) => ({ ...f, position: e.target.value }))}
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>取消</Button>
              <Button
                size="sm"
                onClick={handleAdd}
                disabled={createMember.isPending || !newForm.email || !newForm.password}
              >
                添加
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* 编辑角色/部门/职位 */}
      {editing && (
        <Modal
          title={`编辑成员 · ${editing.user.name || editing.user.email}`}
          onClose={() => setEditing(null)}
        >
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium">角色</label>
              <select
                className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
                value={editForm.role}
                onChange={(e) => setEditForm((f) => ({ ...f, role: e.target.value as 'ENTERPRISE_ADMIN' | 'MEMBER' }))}
              >
                <option value="MEMBER">普通成员</option>
                <option value="ENTERPRISE_ADMIN">企业管理员</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">部门</label>
              <select
                className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
                value={editForm.departmentId ?? ''}
                onChange={(e) => setEditForm((f) => ({ ...f, departmentId: e.target.value || null }))}
              >
                <option value="">不分配部门</option>
                {flatDepts.map((d) => (
                  <option key={d.id} value={d.id}>{d.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">职位</label>
              <Input
                placeholder="如：高级工程师"
                value={editForm.position ?? ''}
                onChange={(e) => setEditForm((f) => ({ ...f, position: e.target.value || null }))}
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>取消</Button>
              <Button size="sm" onClick={handleEdit} disabled={updateMember.isPending}>
                保存
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* 移出确认 */}
      {removing && (
        <Modal title="移出企业" onClose={() => setRemoving(null)}>
          <div className="space-y-4">
            <p className="text-sm text-fg-muted">
              确定将{' '}
              <span className="font-medium text-foreground">
                {removing.user.name || removing.user.email}
              </span>{' '}
              从企业移出？其 User 账号仍保留，但不再属于本企业。
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setRemoving(null)}>取消</Button>
              <Button
                variant="danger"
                size="sm"
                onClick={handleRemove}
                disabled={deleteMember.isPending}
              >
                确认移出
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

