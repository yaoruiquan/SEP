'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { PlusCircle, Pencil, Trash2, X, Package } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/feedback';
import { Avatar } from '@/components/ui/avatar';
import { toast } from '@/components/ui/toast';
import { useEmployees, useEmployee } from '@/features/employee/use-employees';
import { DEFAULT_MODEL_ID } from '@/lib/models';
import { useEnabledModels } from '@/features/model/use-models';
import {
  useCreateEmployee,
  useUpdateEmployee,
  useDeleteEmployee,
  useBindCapability,
  useUnbindCapability,
  useAllCapabilities,
} from '@/features/admin/use-admin';
import type { DigitalEmployee } from '@/lib/types';
import { PublishPackageDialog } from './PublishPackageDialog';

// ─── Status badge ────────────────────────────────────────────────────────────

const STATUS_META: Record<string, { label: string; tone: string }> = {
  DRAFT: { label: '草稿', tone: 'bg-muted text-fg-muted' },
  PUBLISHED: { label: '已发布', tone: 'bg-success/10 text-success' },
  ARCHIVED: { label: '已归档', tone: 'bg-muted text-fg-subtle' },
};

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status];
  return <Badge className={meta?.tone ?? ''}>{meta?.label ?? status}</Badge>;
}

// ─── Zod schema ──────────────────────────────────────────────────────────────

const employeeSchema = z.object({
  name: z.string().min(1, '请输入员工名称'),
  description: z.string().min(10, '描述至少 10 个字符'),
  industry: z.string().min(1, '请输入行业'),
  position: z.string().min(1, '请输入岗位'),
  avatar: z.string().url('请输入有效的图片链接').optional().or(z.literal('')),
  systemPrompt: z.string().min(10, 'Prompt 至少 10 个字符'),
  modelId: z.string().optional(),
  maxSteps: z.coerce.number().int().min(1).max(20).optional(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional(),
});

type EmployeeFormValues = z.infer<typeof employeeSchema>;

// ─── Capability bindings (edit-only sub-section) ─────────────────────────────

function BindingsSection({ employee }: { employee: DigitalEmployee }) {
  const { data: liveEmployee } = useEmployee(employee.id);
  const allCapsQuery = useAllCapabilities();
  const bind = useBindCapability();
  const unbind = useUnbindCapability();
  const [selectedCapId, setSelectedCapId] = useState('');

  const bindings = liveEmployee?.bindings ?? employee.bindings ?? [];
  const approvedCaps = (allCapsQuery.data?.items ?? []).filter(
    (c) => c.status === 'APPROVED',
  );
  const boundIds = new Set(bindings.map((b) => b.capability.id));
  const pickable = approvedCaps.filter((c) => !boundIds.has(c.id));

  const handleBind = () => {
    if (!selectedCapId) return;
    bind.mutate(
      { id: employee.id, capabilityId: selectedCapId },
      { onSuccess: () => setSelectedCapId('') },
    );
  };

  return (
    <div className="border-t border-border pt-4 mt-2 space-y-3">
      <h4 className="text-sm font-semibold">硅基能力绑定</h4>

      {bindings.length === 0 ? (
        <p className="text-xs text-fg-subtle">尚未绑定任何能力</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {bindings.map((b) => (
            <span
              key={b.id}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-medium"
            >
              {b.capability.name}
              <button
                type="button"
                className="ml-0.5 text-fg-muted hover:text-danger"
                onClick={() =>
                  unbind.mutate({
                    id: employee.id,
                    capabilityId: b.capability.id,
                  })
                }
                disabled={unbind.isPending}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {pickable.length > 0 && (
        <div className="flex items-center gap-2">
          <select
            className="h-8 flex-1 rounded border border-border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            value={selectedCapId}
            onChange={(e) => setSelectedCapId(e.target.value)}
          >
            <option value="">选择能力…</option>
            {pickable.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={handleBind}
            disabled={!selectedCapId || bind.isPending}
          >
            绑定
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Create / Edit modal ─────────────────────────────────────────────────────

function EmployeeModal({
  employee,
  onClose,
}: {
  employee: DigitalEmployee | null;
  onClose: () => void;
}) {
  const isEdit = !!employee;
  const create = useCreateEmployee();
  const update = useUpdateEmployee();
  const { data: models, isLoading: modelsLoading } = useEnabledModels();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<EmployeeFormValues>({
    resolver: zodResolver(employeeSchema),
    defaultValues: employee
      ? {
          name: employee.name,
          description: employee.description,
          industry: employee.industry,
          position: employee.position,
          avatar: employee.avatar ?? '',
          systemPrompt: employee.systemPrompt ?? '',
          modelId: employee.modelId ?? DEFAULT_MODEL_ID,
          maxSteps: employee.maxSteps ?? 10,
          status: (employee.status as 'DRAFT' | 'PUBLISHED' | 'ARCHIVED') ?? 'DRAFT',
        }
      : {
          modelId: DEFAULT_MODEL_ID,
          maxSteps: 10,
        },
  });

  const onSubmit = async (values: EmployeeFormValues) => {
    const payload = {
      ...values,
      avatar: values.avatar || undefined,
    };
    if (isEdit && employee) {
      await update.mutateAsync({ id: employee.id, data: payload });
    } else {
      await create.mutateAsync(payload);
    }
    onClose();
  };

  const inputCls =
    'w-full rounded border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring';
  const errorCls = 'mt-0.5 text-xs text-danger';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-lg border border-border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="font-semibold">{isEdit ? '编辑员工' : '新建员工'}</h2>
          <button
            type="button"
            className="text-fg-muted hover:text-foreground"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3 p-5">
          <div>
            <label className="text-xs font-medium text-fg-muted">名称 *</label>
            <input {...register('name')} className={inputCls} />
            {errors.name && <p className={errorCls}>{errors.name.message}</p>}
          </div>

          <div>
            <label className="text-xs font-medium text-fg-muted">描述 *</label>
            <textarea rows={2} {...register('description')} className={inputCls} />
            {errors.description && (
              <p className={errorCls}>{errors.description.message}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-fg-muted">行业 *</label>
              <input {...register('industry')} className={inputCls} />
              {errors.industry && (
                <p className={errorCls}>{errors.industry.message}</p>
              )}
            </div>
            <div>
              <label className="text-xs font-medium text-fg-muted">岗位 *</label>
              <input {...register('position')} className={inputCls} />
              {errors.position && (
                <p className={errorCls}>{errors.position.message}</p>
              )}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-fg-muted">头像 URL</label>
            <input {...register('avatar')} placeholder="https://…" className={inputCls} />
            {errors.avatar && <p className={errorCls}>{errors.avatar.message}</p>}
          </div>

          <div>
            <label className="text-xs font-medium text-fg-muted">System Prompt *</label>
            <textarea rows={4} {...register('systemPrompt')} className={inputCls} />
            {errors.systemPrompt && (
              <p className={errorCls}>{errors.systemPrompt.message}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-fg-muted">AI 模型</label>
              <select {...register('modelId')} className={inputCls} disabled={modelsLoading}>
                {modelsLoading && <option>加载中…</option>}
                {!modelsLoading && (!models || models.length === 0) && (
                  <option value="">上游未配置，请先在系统设置填写</option>
                )}
                {models?.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-fg-muted">
                Max Steps (1-20)
              </label>
              <input
                type="number"
                min={1}
                max={20}
                {...register('maxSteps')}
                className={inputCls}
              />
              {errors.maxSteps && (
                <p className={errorCls}>{errors.maxSteps.message}</p>
              )}
            </div>
          </div>

          {isEdit && (
            <div>
              <label className="text-xs font-medium text-fg-muted">状态</label>
              <select {...register('status')} className={inputCls}>
                <option value="DRAFT">草稿</option>
                <option value="PUBLISHED">已发布</option>
                <option value="ARCHIVED">已归档</option>
              </select>
            </div>
          )}

          {isEdit && employee && <BindingsSection employee={employee} />}

          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <Button type="button" variant="secondary" size="sm" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" size="sm" disabled={isSubmitting}>
              {isEdit ? '保存' : '创建'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function EmployeesPage() {
  const [modal, setModal] = useState<{
    open: boolean;
    employee: DigitalEmployee | null;
  }>({ open: false, employee: null });

  const [confirmDel, setConfirmDel] = useState<DigitalEmployee | null>(null);
  const [publishing, setPublishing] = useState<DigitalEmployee | null>(null);
  const { data: employees, isLoading } = useEmployees();
  const deleteEmployee = useDeleteEmployee();

  const openCreate = () => setModal({ open: true, employee: null });
  const openEdit = (emp: DigitalEmployee) =>
    setModal({ open: true, employee: emp });
  const closeModal = () => setModal({ open: false, employee: null });

  const handleDelete = (emp: DigitalEmployee) => {
    deleteEmployee.mutate(emp.id, {
      onSuccess: () => {
        toast.success(`已删除员工「${emp.name}」`);
        setConfirmDel(null);
      },
      onError: (e) => toast.error(`删除失败: ${(e as Error).message}`),
    });
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">员工管理</h1>
        <Button size="sm" onClick={openCreate}>
          <PlusCircle className="h-4 w-4" />
          新建员工
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>全部员工</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-5">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : !employees || employees.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-fg-subtle">
              🧑‍💼 暂无员工，点击「新建员工」开始创建
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-fg-muted">
                  <th className="px-5 py-2 text-left font-medium">员工</th>
                  <th className="px-5 py-2 text-left font-medium">行业 / 岗位</th>
                  <th className="px-5 py-2 text-left font-medium">状态</th>
                  <th className="px-5 py-2 text-left font-medium">绑定能力</th>
                  <th className="px-5 py-2 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((emp) => (
                  <tr key={emp.id} className="border-b border-border last:border-0 odd:bg-muted/20 transition-colors hover:bg-muted/40">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <Avatar name={emp.name} />
                        <span className="font-medium">{emp.name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-fg-muted">
                      {emp.industry} / {emp.position}
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge status={emp.status} />
                    </td>
                    <td className="px-5 py-3 text-fg-muted">
                      {emp._count?.bindings ?? emp.bindings?.length ?? 0}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setPublishing(emp)}
                          title="发布版本"
                        >
                          <Package className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEdit(emp)}
                          title="编辑"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-danger hover:bg-danger/10"
                          onClick={() => setConfirmDel(emp)}
                          title="删除"
                          disabled={deleteEmployee.isPending}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {modal.open && (
        <EmployeeModal employee={modal.employee} onClose={closeModal} />
      )}

      {confirmDel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-sm rounded-lg border border-border bg-card p-5 shadow-xl">
            <h3 className="font-semibold text-foreground">删除员工</h3>
            <p className="mt-2 text-sm text-fg-muted">
              确定删除员工「{confirmDel.name}」？此操作不可撤销。
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setConfirmDel(null)}
              >
                取消
              </Button>
              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={() => handleDelete(confirmDel)}
                disabled={deleteEmployee.isPending}
              >
                {deleteEmployee.isPending ? '删除中…' : '确认删除'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 发布版本弹窗 */}
      {publishing && (
        <PublishPackageDialog
          employeeId={publishing.id}
          employeeName={publishing.name}
          currentVersion={publishing.version}
          onClose={() => setPublishing(null)}
        />
      )}
    </div>
  );
}
