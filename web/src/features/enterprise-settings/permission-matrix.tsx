'use client';

import { useMemo } from 'react';
import type { CustomRoleView } from './use-enterprise-settings';

// ── Types ────────────────────────────────────────────────────────────────────

interface PermissionMatrixProps {
  roles: CustomRoleView[];
  /** Called when the admin toggles a permission for a non-builtin role. */
  onToggle?: (roleId: string, permission: string, next: boolean) => void;
  /** While a save is in flight, pass the roleId being mutated to show a spinner. */
  saving?: string | null;
}

// ── Permission groups / labels ────────────────────────────────────────────────

const PERM_GROUPS: { label: string; perms: string[] }[] = [
  {
    label: '成员管理',
    perms: ['members:read', 'members:create', 'members:update', 'members:delete'],
  },
  {
    label: '部门管理',
    perms: [
      'departments:read',
      'departments:create',
      'departments:update',
      'departments:delete',
    ],
  },
  {
    label: '角色管理',
    perms: ['roles:read', 'roles:create', 'roles:update', 'roles:delete'],
  },
  {
    label: '企业设置',
    perms: ['settings:read', 'settings:update'],
  },
  {
    label: 'API 密钥',
    perms: ['api-keys:read', 'api-keys:create', 'api-keys:revoke'],
  },
  {
    label: '员工实例',
    perms: [
      'instances:read',
      'instances:create',
      'instances:update',
      'instances:delete',
      'instances:grant',
    ],
  },
  {
    label: '费用统计',
    perms: ['costs:read'],
  },
  {
    label: '知识库',
    perms: [
      'knowledge:read',
      'knowledge:create',
      'knowledge:update',
      'knowledge:delete',
    ],
  },
];

const PERM_LABELS: Record<string, string> = {
  'members:read': '查看',
  'members:create': '添加',
  'members:update': '编辑',
  'members:delete': '删除',
  'departments:read': '查看',
  'departments:create': '创建',
  'departments:update': '编辑',
  'departments:delete': '删除',
  'roles:read': '查看',
  'roles:create': '创建',
  'roles:update': '编辑',
  'roles:delete': '删除',
  'settings:read': '查看',
  'settings:update': '修改',
  'api-keys:read': '查看',
  'api-keys:create': '创建',
  'api-keys:revoke': '吊销',
  'instances:read': '查看',
  'instances:create': '创建',
  'instances:update': '编辑',
  'instances:delete': '删除',
  'instances:grant': '授权',
  'costs:read': '查看费用',
  'knowledge:read': '查看',
  'knowledge:create': '创建',
  'knowledge:update': '编辑',
  'knowledge:delete': '删除',
};

// ── Component ─────────────────────────────────────────────────────────────────

export function PermissionMatrix({ roles, onToggle, saving }: PermissionMatrixProps) {
  // Build a Set<permission> per role for O(1) lookup
  const permSets = useMemo(
    () =>
      Object.fromEntries(
        roles.map((r) => [r.id, new Set<string>(r.permissions)]),
      ),
    [roles],
  );

  if (roles.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-fg-muted">暂无角色</p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40">
            <th className="sticky left-0 z-10 min-w-[160px] bg-muted/40 px-4 py-3 text-left font-medium text-fg-muted">
              权限
            </th>
            {roles.map((role) => (
              <th
                key={role.id}
                className="min-w-[96px] px-3 py-3 text-center font-medium text-foreground"
              >
                <span>{role.name}</span>
                {role.isBuiltin && (
                  <span className="ml-1 text-xs text-fg-muted">（内置）</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {PERM_GROUPS.map((group) => (
            <>
              {/* Group header row */}
              <tr key={`group-${group.label}`} className="border-b border-border bg-muted/20">
                <td
                  colSpan={roles.length + 1}
                  className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-fg-muted"
                >
                  {group.label}
                </td>
              </tr>

              {/* Permission rows */}
              {group.perms.map((perm, idx) => (
                <tr
                  key={perm}
                  className={`border-b border-border ${
                    idx % 2 === 0 ? '' : 'bg-muted/10'
                  } hover:bg-muted/20`}
                >
                  {/* Permission label */}
                  <td className="sticky left-0 bg-background px-4 py-2.5 text-foreground">
                    {PERM_LABELS[perm] ?? perm}
                    <span className="ml-2 text-xs text-fg-muted/60">{perm}</span>
                  </td>

                  {/* Checkboxes per role */}
                  {roles.map((role) => {
                    const checked = permSets[role.id]?.has(perm) ?? false;
                    const isSaving = saving === role.id;
                    const disabled = role.isBuiltin || isSaving;

                    return (
                      <td
                        key={role.id}
                        className="px-3 py-2.5 text-center"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disabled}
                          onChange={() => onToggle?.(role.id, perm, !checked)}
                          title={role.isBuiltin ? '内置角色权限不可修改' : undefined}
                          className="h-4 w-4 cursor-pointer accent-primary disabled:cursor-default disabled:opacity-50"
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </>
          ))}
        </tbody>
      </table>
    </div>
  );
}
