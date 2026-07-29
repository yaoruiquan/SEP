'use client';

import { useState } from 'react';
import { Trash2, Plus, Users, Building2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/feedback';
import { toast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api-client';
import {
  useInstanceGrants,
  useCreateGrant,
  useDeleteGrant,
  useDepartments,
  useMembers,
} from './use-enterprise';
import { flattenDepts } from './flatten-depts';
import type { EmployeeInstance } from '@/lib/types';

function Modal({
  title, onClose, children,
}: { title: string; onClose: () => void; children: React.ReactNode }) {
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

/**
 * 某个实例的授权管理面板。
 *
 * 授权对象**二选一**（部门或成员）—— 后端用 zod refine 强制，两个都传或
 * 都不传返回 400。故 UI 用单选切换而非两个独立下拉，让用户无从踩到那个 400。
 */
export function GrantPanel({
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

  const [target, setTarget] = useState<'department' | 'member'>('member');
  const [targetId, setTargetId] = useState('');
  const [expiresAt, setExpiresAt] = useState('');

  const flatDepts = flattenDepts(depts);

  const handleAdd = () => {
    if (!targetId) return;
    createGrant.mutate(
      {
        instanceId: instance.id,
        ...(target === 'department' ? { departmentId: targetId } : { memberId: targetId }),
        // datetime-local 是本地时间，转 ISO 再交给后端
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

        <div className="space-y-3 border-t border-border pt-4">
          <p className="text-xs font-medium uppercase tracking-wider text-fg-subtle">
            开通新授权
          </p>

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
            <option value="">{target === 'member' ? '选择成员…' : '选择部门…'}</option>
            {target === 'member'
              ? members.map((m) => (
                  <option key={m.id} value={m.id}>{m.user.name || m.user.email}</option>
                ))
              : flatDepts.map((d) => (
                  <option key={d.id} value={d.id}>{d.label}</option>
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
