'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  UserPlus,
  Crown,
  UserMinus,
  Search,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { CenteredSpinner, EmptyState } from '@/components/ui/feedback';
import { toast } from '@/components/ui/toast';
import { useAuthStore } from '@/lib/auth-store';
import { ApiError } from '@/lib/api-client';
import { useDepartments } from '@/features/enterprise/use-enterprise';
import {
  useDeptMembers,
  useRemoveDeptMember,
  useSetDeptLeader,
} from '@/features/enterprise/use-department-members';
import { AddMembersDialog } from '@/features/enterprise/add-members-dialog';
import type { DeptMemberItem } from '@/lib/types';

// ── 成员行 ───────────────────────────────────────────────────────────────────

function MemberRow({
  member,
  isLeader,
  canManage,
  onSetLeader,
  onClearLeader,
  onRemove,
  removing,
  settingLeader,
}: {
  member: DeptMemberItem;
  isLeader: boolean;
  canManage: boolean;
  onSetLeader: () => void;
  onClearLeader: () => void;
  onRemove: () => void;
  removing: boolean;
  settingLeader: boolean;
}) {
  const displayName = member.user.name ?? member.user.email;
  const initials = displayName[0].toUpperCase();

  return (
    <tr className="border-b border-border last:border-0">
      <td className="py-3 pl-4 pr-3">
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/20 text-sm font-bold text-primary">
            {initials}
          </span>
          <div>
            <p className="flex items-center gap-1.5 text-sm font-medium">
              {displayName}
              {isLeader && (
                <Crown className="h-3.5 w-3.5 text-amber-500" aria-label="部门主管" />
              )}
            </p>
            {member.user.name && (
              <p className="text-xs text-fg-muted">{member.user.email}</p>
            )}
          </div>
        </div>
      </td>

      <td className="px-3 py-3 text-sm text-fg-muted">
        {member.position ?? '—'}
      </td>

      <td className="px-3 py-3">
        <Badge
          className={
            member.role === 'ENTERPRISE_ADMIN'
              ? 'bg-primary/10 text-primary'
              : member.role === 'DEPT_MANAGER'
              ? 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
              : 'bg-muted text-fg-muted'
          }
        >
          {member.role === 'ENTERPRISE_ADMIN'
            ? '企业管理员'
            : member.role === 'DEPT_MANAGER'
            ? '部门管理员'
            : '成员'}
        </Badge>
      </td>

      <td className="px-3 py-3 text-sm text-fg-muted">
        {new Date(member.createdAt).toLocaleDateString('zh-CN')}
      </td>

      {canManage && (
        <td className="py-3 pl-3 pr-4">
          <div className="flex items-center justify-end gap-1.5">
            {isLeader ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={onClearLeader}
                disabled={settingLeader}
                className="h-7 px-2 text-xs text-fg-muted"
              >
                取消主管
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={onSetLeader}
                disabled={settingLeader}
                className="h-7 px-2 text-xs"
              >
                <Crown className="mr-1 h-3 w-3" />
                设为主管
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={onRemove}
              disabled={removing}
              className="h-7 px-2 text-xs text-danger hover:bg-danger/10"
            >
              <UserMinus className="mr-1 h-3 w-3" />
              移出
            </Button>
          </div>
        </td>
      )}
    </tr>
  );
}

// ── 页面 ─────────────────────────────────────────────────────────────────────

export default function DeptMembersPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const deptId = params.id;

  const { roleInEnterprise } = useAuthStore();
  const isAdmin = roleInEnterprise === 'ENTERPRISE_ADMIN';

  const [search, setSearch] = useState('');
  const [showAddDialog, setShowAddDialog] = useState(false);

  const { data: depts = [] } = useDepartments();
  const dept = findDept(depts, deptId);

  const { data, isLoading, isError, error } = useDeptMembers(deptId, {
    search: search || undefined,
  });

  const removeMember = useRemoveDeptMember(deptId);
  const setLeader = useSetDeptLeader(deptId);

  const leaderId = data?.leaderId ?? null;

  // Is the current user the dept leader?
  // We can check this via leaderId but we need memberId — use isAdmin for now as canManage flag
  const canManage = isAdmin;

  const handleRemove = (member: DeptMemberItem) => {
    if (!confirm(`确定将 ${member.user.name ?? member.user.email} 移出部门？`)) return;
    removeMember.mutate(member.id, {
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
      onSuccess: () => toast.success('已取消主管设置'),
      onError: (e) => toast.error(e instanceof ApiError ? e.message : '操作失败'),
    });
  };

  if (isLoading) return <CenteredSpinner label="加载成员…" />;
  if (isError) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <EmptyState
          icon={<Users className="h-8 w-8" />}
          title="加载失败"
          description={error?.message || '无法加载成员列表'}
          action={
            <Button size="sm" onClick={() => window.location.reload()}>刷新</Button>
          }
        />
      </div>
    );
  }

  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="space-y-6 p-6">
      {/* 返回按钮 + 标题 */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.back()}
          className="rounded p-1.5 text-fg-muted hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">
            {dept?.name ?? '部门'}
            <span className="ml-2 text-base font-normal text-fg-muted">成员管理</span>
          </h1>
          <p className="mt-0.5 text-sm text-fg-muted">
            共 {total} 位成员
            {leaderId && items.find((m) => m.id === leaderId) && (
              <>
                {' · '}主管：
                <span className="font-medium text-foreground">
                  {items.find((m) => m.id === leaderId)?.user.name ??
                    items.find((m) => m.id === leaderId)?.user.email}
                </span>
              </>
            )}
          </p>
        </div>
        {canManage && (
          <Button size="sm" onClick={() => setShowAddDialog(true)}>
            <UserPlus className="h-4 w-4" />
            添加成员
          </Button>
        )}
      </div>

      {/* 搜索 */}
      <div className="relative max-w-xs">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" />
        <Input
          placeholder="搜索姓名或邮箱…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* 成员表格 */}
      {items.length === 0 ? (
        <EmptyState
          icon={<Users className="h-8 w-8" />}
          title={search ? '无匹配成员' : '还没有成员'}
          description={
            search
              ? '试试其他搜索词。'
              : canManage
              ? '点击「添加成员」将企业成员加入此部门。'
              : '此部门暂无成员。'
          }
          action={
            canManage && !search ? (
              <Button size="sm" onClick={() => setShowAddDialog(true)}>
                添加成员
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="rounded-lg border border-border bg-background">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border text-xs text-fg-muted">
                <th className="py-2.5 pl-4 pr-3 font-medium">成员</th>
                <th className="px-3 py-2.5 font-medium">职位</th>
                <th className="px-3 py-2.5 font-medium">角色</th>
                <th className="px-3 py-2.5 font-medium">加入时间</th>
                {canManage && <th className="py-2.5 pl-3 pr-4 text-right font-medium">操作</th>}
              </tr>
            </thead>
            <tbody>
              {items.map((member) => (
                <MemberRow
                  key={member.id}
                  member={member}
                  isLeader={member.id === leaderId}
                  canManage={canManage}
                  onSetLeader={() => handleSetLeader(member.id)}
                  onClearLeader={handleClearLeader}
                  onRemove={() => handleRemove(member)}
                  removing={removeMember.isPending}
                  settingLeader={setLeader.isPending}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAddDialog && dept && (
        <AddMembersDialog
          deptId={deptId}
          deptName={dept.name}
          onClose={() => setShowAddDialog(false)}
        />
      )}
    </div>
  );
}

// ── 工具函数 ─────────────────────────────────────────────────────────────────

import type { Department } from '@/lib/types';

function findDept(depts: Department[], id: string): Department | undefined {
  for (const d of depts) {
    if (d.id === id) return d;
    const found = findDept(d.children, id);
    if (found) return found;
  }
  return undefined;
}
