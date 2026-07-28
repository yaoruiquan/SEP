'use client';

import { useState } from 'react';
import { Plus, Pencil, Trash2, ChevronRight, ChevronDown, Users } from 'lucide-react';
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
import type { Department } from '@/lib/types';

// ── 简单内联 Modal ────────────────────────────────────────────────────────────

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

// ── 部门树节点 ─────────────────────────────────────────────────────────────────

function DeptNode({
  dept,
  depth,
  isAdmin,
  onRename,
  onDelete,
  onAddChild,
}: {
  dept: Department;
  depth: number;
  isAdmin: boolean;
  onRename: (d: Department) => void;
  onDelete: (d: Department) => void;
  onAddChild: (parentId: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = dept.children.length > 0;

  return (
    <div>
      <div
        className="group flex items-center gap-2 rounded px-2 py-1.5 hover:bg-muted"
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
      >
        {/* expand/collapse toggle */}
        <button
          onClick={() => hasChildren && setExpanded(!expanded)}
          className="w-4 shrink-0 text-fg-muted"
        >
          {hasChildren ? (
            expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />
          ) : (
            <span className="inline-block w-3.5" />
          )}
        </button>

        <span className="flex-1 text-sm font-medium">{dept.name}</span>

        {/* 成员数 */}
        {typeof dept._count?.members === 'number' && (
          <Badge className="bg-muted text-fg-muted">
            {dept._count.members} 人
          </Badge>
        )}

        {/* 管理员操作 */}
        {isAdmin && (
          <div className="hidden items-center gap-1 group-hover:flex">
            <button
              title="添加子部门"
              onClick={() => onAddChild(dept.id)}
              className="rounded p-1 text-fg-muted hover:bg-primary-subtle hover:text-primary"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            <button
              title="重命名"
              onClick={() => onRename(dept)}
              className="rounded p-1 text-fg-muted hover:bg-primary-subtle hover:text-primary"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              title="删除"
              onClick={() => onDelete(dept)}
              className="rounded p-1 text-fg-muted hover:bg-danger/10 hover:text-danger"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* 子节点 */}
      {expanded &&
        dept.children.map((child) => (
          <DeptNode
            key={child.id}
            dept={child}
            depth={depth + 1}
            isAdmin={isAdmin}
            onRename={onRename}
            onDelete={onDelete}
            onAddChild={onAddChild}
          />
        ))}
    </div>
  );
}

// ── 页面 ──────────────────────────────────────────────────────────────────────

export default function DepartmentsPage() {
  const { roleInEnterprise } = useAuthStore();
  const isAdmin = roleInEnterprise === 'ENTERPRISE_ADMIN';

  const { data: depts = [], isLoading } = useDepartments();
  const createDept = useCreateDepartment();
  const updateDept = useUpdateDepartment();
  const deleteDept = useDeleteDepartment();

  // modal state
  const [creating, setCreating] = useState<{ parentId?: string } | null>(null);
  const [renaming, setRenaming] = useState<Department | null>(null);
  const [deleting, setDeleting] = useState<Department | null>(null);

  // form state
  const [draftName, setDraftName] = useState('');

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
      onSuccess: () => { toast.success('已删除'); setDeleting(null); },
      onError: (e) => toast.error(e instanceof ApiError ? e.message : '删除失败（请先清空子部门和成员）'),
    });
  };

  if (isLoading) return <CenteredSpinner label="加载中…" />;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">部门管理</h1>
          <p className="mt-1 text-sm text-fg-muted">
            管理企业的组织架构
          </p>
        </div>
        {isAdmin && (
          <Button
            size="sm"
            onClick={() => { setCreating({}); setDraftName(''); }}
          >
            <Plus className="h-4 w-4" />
            新建顶级部门
          </Button>
        )}
      </div>

      {depts.length === 0 ? (
        <EmptyState
          icon={<Users className="h-8 w-8" />}
          title="还没有部门"
          description={isAdmin ? '创建第一个部门来组织你的团队。' : '企业还没有创建部门。'}
          action={
            isAdmin ? (
              <Button size="sm" onClick={() => { setCreating({}); setDraftName(''); }}>
                新建部门
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="rounded-lg border border-border bg-background py-2">
          {depts.map((d) => (
            <DeptNode
              key={d.id}
              dept={d}
              depth={0}
              isAdmin={isAdmin}
              onRename={(dept) => { setRenaming(dept); setDraftName(dept.name); }}
              onDelete={(dept) => setDeleting(dept)}
              onAddChild={(parentId) => { setCreating({ parentId }); setDraftName(''); }}
            />
          ))}
        </div>
      )}

      {/* 新建部门 */}
      {creating !== null && (
        <Modal
          title={creating.parentId ? '添加子部门' : '新建顶级部门'}
          onClose={() => setCreating(null)}
        >
          <div className="space-y-4">
            <Input
              placeholder="部门名称"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setCreating(null)}>
                取消
              </Button>
              <Button
                size="sm"
                onClick={handleCreate}
                disabled={createDept.isPending || !draftName.trim()}
              >
                创建
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* 重命名 */}
      {renaming !== null && (
        <Modal title="重命名部门" onClose={() => setRenaming(null)}>
          <div className="space-y-4">
            <Input
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleRename()}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setRenaming(null)}>
                取消
              </Button>
              <Button
                size="sm"
                onClick={handleRename}
                disabled={updateDept.isPending || !draftName.trim()}
              >
                保存
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* 删除确认 */}
      {deleting !== null && (
        <Modal title="删除部门" onClose={() => setDeleting(null)}>
          <div className="space-y-4">
            <p className="text-sm text-fg-muted">
              确定删除部门{' '}
              <span className="font-medium text-foreground">
                {deleting.name}
              </span>
              ？删除前需先清空其子部门和成员。
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setDeleting(null)}>
                取消
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={handleDelete}
                disabled={deleteDept.isPending}
              >
                确认删除
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
