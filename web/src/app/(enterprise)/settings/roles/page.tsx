'use client';

import { useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Trash2, Loader2, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CenteredSpinner } from '@/components/ui/feedback';
import {
  useCustomRoles,
  useCreateCustomRole,
  useDeleteCustomRole,
} from '@/features/enterprise-settings/use-enterprise-settings';
import { ENTERPRISE_PERMISSIONS } from '../../../../../../backend/src/shared/enterprise-settings.dto';
import type { ApiError } from '@/lib/api-client';

const createRoleSchema = z.object({
  name: z.string().min(1, '角色名不能为空').max(50),
  description: z.string().max(200).optional(),
  permissions: z.array(z.string()).min(1, '至少选择一个权限'),
});

type FormValues = z.infer<typeof createRoleSchema>;

// Human-readable labels for permissions
const PERM_LABELS: Record<string, string> = {
  'members:read': '查看成员',
  'members:create': '添加成员',
  'members:update': '编辑成员',
  'members:delete': '删除成员',
  'departments:read': '查看部门',
  'departments:create': '创建部门',
  'departments:update': '编辑部门',
  'departments:delete': '删除部门',
  'roles:read': '查看角色',
  'roles:create': '创建角色',
  'roles:update': '编辑角色',
  'roles:delete': '删除角色',
  'settings:read': '查看企业设置',
  'settings:update': '修改企业设置',
  'api-keys:read': '查看 API 密钥',
  'api-keys:create': '创建 API 密钥',
  'api-keys:revoke': '吊销 API 密钥',
  'subscriptions:read': '查看硅基员工',
  'subscriptions:create': '雇佣硅基员工',
  'subscriptions:update': '编辑硅基员工',
  'subscriptions:delete': '解聘硅基员工',
  'subscriptions:grant': '授权硅基员工',
  'costs:read': '查看费用统计',
  'knowledge:read': '查看知识库',
  'knowledge:create': '创建知识库',
  'knowledge:update': '编辑知识库',
  'knowledge:delete': '删除知识库',
};

export default function RolesPage() {
  const { data: roles, isLoading } = useCustomRoles();
  const createRole = useCreateCustomRole();
  const deleteRole = useDeleteCustomRole();
  const [open, setOpen] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(createRoleSchema),
    defaultValues: { name: '', description: '', permissions: [] },
  });

  const onSubmit = form.handleSubmit((values) => {
    createRole.mutate(
      { name: values.name, description: values.description, permissions: values.permissions as any },
      {
        onSuccess: () => {
          setOpen(false);
          form.reset();
        },
      },
    );
  });

  if (isLoading) return <CenteredSpinner label="加载中…" />;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">角色权限</h1>
          <p className="mt-1 text-sm text-fg-muted">
            管理企业自定义角色，内置角色不可修改。
          </p>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" />
          新建角色
        </Button>
      </div>

      <div className="space-y-3">
        {roles?.map((role) => (
          <Card key={role.id}>
            <CardHeader className="flex flex-row items-center justify-between py-3">
              <div className="flex items-center gap-2">
                <CardTitle className="text-base">{role.name}</CardTitle>
                {role.isBuiltin && (
                  <Badge variant="default" className="flex items-center gap-1 text-xs bg-glass-2 border border-glassline">
                    <Lock className="h-3 w-3" />
                    内置
                  </Badge>
                )}
                <span className="text-sm text-fg-muted">
                  {role.memberCount} 位成员
                </span>
              </div>
              {!role.isBuiltin && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-danger hover:text-danger"
                  onClick={() => {
                    if (confirm(`确认删除角色「${role.name}」？已绑定该角色的成员将回退到内置权限。`)) {
                      deleteRole.mutate(role.id);
                    }
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </CardHeader>
            {role.description && (
              <CardContent className="pb-3 pt-0 text-sm text-fg-muted">
                {role.description}
              </CardContent>
            )}
            <CardContent className="pb-4 pt-0">
              <div className="flex flex-wrap gap-1.5">
                {role.permissions.map((p) => (
                  <Badge key={p} variant="glass" className="text-xs">
                    {PERM_LABELS[p] ?? p}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Create Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>新建自定义角色</DialogTitle>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                角色名称
              </label>
              <Input {...form.register('name')} placeholder="如：数据分析师" />
              {form.formState.errors.name && (
                <p className="mt-1 text-sm text-danger">
                  {form.formState.errors.name.message}
                </p>
              )}
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                描述（可选）
              </label>
              <Input {...form.register('description')} placeholder="角色用途说明" />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-foreground">
                权限
              </label>
              <Controller
                control={form.control}
                name="permissions"
                render={({ field }) => (
                  <div className="grid grid-cols-2 gap-1.5">
                    {ENTERPRISE_PERMISSIONS.map((perm) => {
                      const checked = field.value.includes(perm);
                      return (
                        <label
                          key={perm}
                          className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-sm hover:bg-muted"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              field.onChange(
                                checked
                                  ? field.value.filter((p) => p !== perm)
                                  : [...field.value, perm],
                              );
                            }}
                          />
                          {PERM_LABELS[perm] ?? perm}
                        </label>
                      );
                    })}
                  </div>
                )}
              />
              {form.formState.errors.permissions && (
                <p className="mt-1 text-sm text-danger">
                  {form.formState.errors.permissions.message}
                </p>
              )}
            </div>
            {createRole.error && (
              <p className="text-sm text-danger">
                {(createRole.error as ApiError).message || '创建失败'}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                取消
              </Button>
              <Button type="submit" disabled={createRole.isPending}>
                {createRole.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                创建
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
