'use client';

import { useState } from 'react';
import { Trash2, Plus, Users, UserCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { CenteredSpinner } from '@/components/ui/feedback';
import {
  useKnowledgeGrants,
  useCreateGrant,
  useDeleteGrant,
  useEmployeeInstances,
  type KnowledgeGrant,
  type EmployeeInstance,
} from './use-knowledge-grants';

interface KnowledgeGrantsPanelProps {
  knowledgeBaseId: string;
}

export function KnowledgeGrantsPanel({ knowledgeBaseId }: KnowledgeGrantsPanelProps) {
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const { data: grants = [], isLoading } = useKnowledgeGrants(knowledgeBaseId);
  const deleteGrant = useDeleteGrant(knowledgeBaseId);

  const handleDelete = (grantId: string) => {
    deleteGrant.mutate(grantId);
  };

  if (isLoading) {
    return <CenteredSpinner label="加载授权列表..." />;
  }

  return (
    <div className="space-y-4">
      {/* 标题行 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <UserCheck className="h-4 w-4 text-fg-muted" />
          <span className="text-sm font-medium text-fg-muted">
            已授权员工实例
          </span>
          <Badge variant="glass-info" className="text-xs">
            {grants.length}
          </Badge>
        </div>
        <Button variant="primary" onClick={() => setAddDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          授权员工实例
        </Button>
      </div>

      {/* 授权列表 */}
      {grants.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-12 text-center">
          <Users className="mx-auto mb-3 h-8 w-8 text-fg-subtle" />
          <p className="text-sm font-medium text-fg-muted">暂无授权</p>
          <p className="mt-1 text-xs text-fg-subtle">
            授权员工实例后，该知识库将在对话中自动被检索
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {grants.map((grant) => (
            <GrantRow
              key={grant.id}
              grant={grant}
              onDelete={handleDelete}
              deleting={deleteGrant.isPending}
            />
          ))}
        </ul>
      )}

      {/* 添加授权对话框 */}
      <AddGrantDialog
        open={addDialogOpen}
        onClose={() => setAddDialogOpen(false)}
        knowledgeBaseId={knowledgeBaseId}
        existingInstanceIds={grants
          .map((g) => g.instanceId)
          .filter(Boolean) as string[]}
      />
    </div>
  );
}

// ── 单行授权记录 ──────────────────────────────────────────────────────────────

function GrantRow({
  grant,
  onDelete,
  deleting,
}: {
  grant: KnowledgeGrant;
  onDelete: (id: string) => void;
  deleting: boolean;
}) {
  const name = grant.instance?.name ?? grant.department?.name ?? '未知';
  const templateName = grant.instance?.template.name;

  return (
    <li className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
      <Avatar name={name} className="h-8 w-8 shrink-0 text-sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-fg-primary">{name}</p>
        {templateName && (
          <p className="truncate text-xs text-fg-subtle">{templateName}</p>
        )}
      </div>
      {grant.instanceId ? (
        <Badge variant="glass-success" className="text-xs">员工实例</Badge>
      ) : (
        <Badge variant="glass-info" className="text-xs">部门</Badge>
      )}
      <Button
        variant="ghost"
        onClick={() => onDelete(grant.id)}
        disabled={deleting}
        className="h-8 w-8 shrink-0 p-0 text-fg-subtle hover:text-danger"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </li>
  );
}

// ── 添加授权对话框 ─────────────────────────────────────────────────────────────

interface AddGrantDialogProps {
  open: boolean;
  onClose: () => void;
  knowledgeBaseId: string;
  existingInstanceIds: string[];
}

function AddGrantDialog({
  open,
  onClose,
  knowledgeBaseId,
  existingInstanceIds,
}: AddGrantDialogProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const { data: instances = [], isLoading } = useEmployeeInstances();
  const createGrant = useCreateGrant(knowledgeBaseId);

  const available = instances.filter(
    (inst) => !existingInstanceIds.includes(inst.id),
  );

  const handleConfirm = () => {
    if (!selected) return;
    createGrant.mutate(
      { instanceId: selected },
      {
        onSuccess: () => {
          setSelected(null);
          onClose();
        },
      },
    );
  };

  const handleClose = () => {
    setSelected(null);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>授权员工实例</DialogTitle>
        </DialogHeader>

        <div className="max-h-80 overflow-y-auto scroll-thin">
          {isLoading ? (
            <CenteredSpinner label="加载员工实例..." />
          ) : available.length === 0 ? (
            <p className="py-8 text-center text-sm text-fg-muted">
              所有员工实例均已授权
            </p>
          ) : (
            <ul className="space-y-1.5 py-1">
              {available.map((inst) => (
                <InstanceOption
                  key={inst.id}
                  instance={inst}
                  selected={selected === inst.id}
                  onSelect={() =>
                    setSelected((prev) => (prev === inst.id ? null : inst.id))
                  }
                />
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={handleClose}>
            取消
          </Button>
          <Button
            variant="primary"
            onClick={handleConfirm}
            disabled={!selected || createGrant.isPending}
          >
            {createGrant.isPending ? '授权中...' : '确认授权'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InstanceOption({
  instance,
  selected,
  onSelect,
}: {
  instance: EmployeeInstance;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-muted ${
          selected ? 'bg-primary/10 ring-1 ring-primary/30' : ''
        }`}
      >
        <Avatar
          name={instance.name}
          src={instance.template.avatar ?? undefined}
          className="h-8 w-8 shrink-0 text-sm"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-fg-primary">
            {instance.name}
          </p>
          <p className="truncate text-xs text-fg-subtle">
            {instance.template.name}
          </p>
        </div>
        {selected && (
          <UserCheck className="h-4 w-4 shrink-0 text-primary" />
        )}
      </button>
    </li>
  );
}
