'use client';

import { useState, useMemo } from 'react';
import { Search, UserPlus, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api-client';
import { useMembers } from '@/features/enterprise/use-enterprise';
import { useAssignDeptMembers, useDeptMembers } from '@/features/enterprise/use-department-members';

interface Props {
  deptId: string;
  deptName: string;
  onClose: () => void;
}

export function AddMembersDialog({ deptId, deptName, onClose }: Props) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // 全部企业成员
  const { data: allMembers = [], isLoading: loadingAll } = useMembers();
  // 当前部门成员（用来标记已在部门中的人）
  const { data: deptData } = useDeptMembers(deptId, { limit: 200 });

  const inDeptIds = useMemo(
    () => new Set((deptData?.items ?? []).map((m) => m.id)),
    [deptData],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allMembers.filter((m) => {
      if (!q) return true;
      return (
        m.user.name?.toLowerCase().includes(q) ||
        m.user.email.toLowerCase().includes(q)
      );
    });
  }, [allMembers, search]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const assign = useAssignDeptMembers(deptId);

  const handleConfirm = () => {
    const ids = [...selected];
    if (!ids.length) return;
    assign.mutate(ids, {
      onSuccess: ({ assigned }) => {
        toast.success(`已添加 ${assigned} 位成员`);
        onClose();
      },
      onError: (e) => toast.error(e instanceof ApiError ? e.message : '添加失败'),
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 flex w-full max-w-md flex-col rounded-xl border border-border bg-background shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <div className="flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-primary" />
            <h3 className="text-base font-semibold">添加成员</h3>
          </div>
          <button onClick={onClose} className="text-fg-muted hover:text-foreground">✕</button>
        </div>

        <p className="px-5 pt-3 text-sm text-fg-muted">
          选择企业成员加入「{deptName}」。已在部门中的成员以灰色显示。
        </p>

        {/* Search */}
        <div className="relative px-5 pt-3">
          <Search className="absolute left-8 top-5 h-4 w-4 text-fg-muted" />
          <Input
            placeholder="搜索姓名或邮箱…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Member list */}
        <div className="mx-5 mt-3 max-h-72 overflow-y-auto rounded-lg border border-border">
          {loadingAll ? (
            <div className="flex items-center justify-center p-6 text-sm text-fg-muted">加载中…</div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center p-6 text-sm text-fg-muted">无匹配成员</div>
          ) : (
            filtered.map((m) => {
              const alreadyIn = inDeptIds.has(m.id);
              const isSelected = selected.has(m.id);
              return (
                <button
                  key={m.id}
                  onClick={() => !alreadyIn && toggle(m.id)}
                  disabled={alreadyIn}
                  className={[
                    'flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors',
                    alreadyIn
                      ? 'cursor-default opacity-40'
                      : isSelected
                      ? 'bg-primary/10'
                      : 'hover:bg-muted',
                  ].join(' ')}
                >
                  {/* checkbox indicator */}
                  <span
                    className={[
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                      isSelected && !alreadyIn
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border',
                    ].join(' ')}
                  >
                    {(isSelected && !alreadyIn) && <Check className="h-2.5 w-2.5" />}
                    {alreadyIn && <Check className="h-2.5 w-2.5 text-fg-muted" />}
                  </span>

                  {/* Avatar */}
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/20 text-xs font-bold text-primary">
                    {m.user.name?.[0]?.toUpperCase() ?? m.user.email[0].toUpperCase()}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {m.user.name ?? m.user.email}
                      {alreadyIn && (
                        <span className="ml-1.5 text-xs text-fg-muted">（已在部门）</span>
                      )}
                    </p>
                    {m.user.name && (
                      <p className="truncate text-xs text-fg-muted">{m.user.email}</p>
                    )}
                  </div>

                  {m.department && !alreadyIn && (
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-fg-muted">
                      {m.department.name}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border px-5 py-3.5">
          <span className="text-sm text-fg-muted">
            {selected.size > 0 ? `已选 ${selected.size} 人` : '未选择'}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              取消
            </Button>
            <Button
              size="sm"
              onClick={handleConfirm}
              disabled={selected.size === 0 || assign.isPending}
            >
              确认添加
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
