'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import Link from 'next/link';
import { MoreVertical, Edit, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/feedback';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  useAllCapabilities,
  useImportCozeBot,
} from '@/features/admin/use-admin';
import { CAPABILITY_TYPE_META } from '@/lib/utils';
import type { Capability } from '@/lib/types';

const STATUS_META: Record<string, { label: string; tone: string }> = {
  PENDING: { label: '待审核', tone: 'bg-warning/10 text-warning' },
  APPROVED: { label: '已通过', tone: 'bg-success/10 text-success' },
  REJECTED: { label: '已拒绝', tone: 'bg-danger/10 text-danger' },
};

function TypeBadge({ type }: { type: string }) {
  const meta = CAPABILITY_TYPE_META[type];
  return <Badge className={meta?.tone ?? ''}>{meta?.label ?? type}</Badge>;
}

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status];
  return <Badge className={meta?.tone ?? ''}>{meta?.label ?? status}</Badge>;
}

// ─── Coze Import Form ────────────────────────────────────────────────────────

const cozeImportSchema = z.object({
  botId: z.string().min(1, '请输入 Bot ID'),
  name: z.string().min(1, '请输入能力名称'),
  description: z.string().min(10, '描述至少 10 个字符'),
});

type CozeImportFormValues = z.infer<typeof cozeImportSchema>;

function CozeImportForm() {
  const importMutation = useImportCozeBot();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CozeImportFormValues>({
    resolver: zodResolver(cozeImportSchema),
  });

  const onSubmit = async (values: CozeImportFormValues) => {
    try {
      await importMutation.mutateAsync(values);
      toast.success(`Coze Bot 导入成功：${values.name}`);
      reset();
    } catch (err) {
      toast.error(`导入失败：${(err as Error).message}`);
    }
  };

  const inputCls =
    'w-full rounded border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';
  const errorCls = 'mt-1 text-xs text-danger';

  return (
    <Card>
      <CardHeader>
        <CardTitle>导入 Coze Bot</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">
              Bot ID <span className="text-danger">*</span>
            </label>
            <Input
              {...register('botId')}
              placeholder="7xxxxxxxxxxxxxx"
              className={inputCls}
            />
            {errors.botId && <p className={errorCls}>{errors.botId.message}</p>}
            <p className="mt-1 text-xs text-fg-subtle">
              在 Coze 控制台的 Bot 详情页获取(形如 7xxxxxxxxxxxxxx)
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              能力名称 <span className="text-danger">*</span>
            </label>
            <Input {...register('name')} placeholder="例如:天气查询助手" className={inputCls} />
            {errors.name && <p className={errorCls}>{errors.name.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              能力描述 <span className="text-danger">*</span>
            </label>
            <textarea
              {...register('description')}
              rows={3}
              placeholder="描述该 Bot 的功能和使用场景..."
              className={inputCls}
            />
            {errors.description && <p className={errorCls}>{errors.description.message}</p>}
          </div>

          <div className="rounded border border-border bg-muted/30 p-3 text-sm text-fg-muted">
            <p className="font-medium mb-1">📌 说明</p>
            <ul className="list-disc list-inside space-y-0.5 text-xs">
              <li>Coze PAT 由服务端全局配置(环境变量 COZE_PAT),无需在此填写</li>
              <li>导入后能力状态为"已通过",可直接绑定到员工</li>
              <li>确保该 Bot 在 Coze 控制台已发布且可访问</li>
            </ul>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => reset()}>
              重置
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? '导入中...' : '导入'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

type TabKey = 'approved' | 'all';

export default function CapabilitiesPage() {
  const [tab, setTab] = useState<TabKey>('approved');
  const approvedQuery = useAllCapabilities('APPROVED');
  const allQuery = useAllCapabilities();

  const approvedItems = approvedQuery.data?.items ?? [];
  const allItems = allQuery.data?.items ?? [];

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">能力管理</h1>
        <Link href="/admin/capabilities/new">
          <Button>+ 新建能力</Button>
        </Link>
      </div>

      <div className="flex gap-1 border-b border-border">
        {(
          [
            { key: 'approved', label: '已发布' },
            { key: 'all', label: '全部' },
          ] as { key: TabKey; label: string }[]
        ).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === key
                ? 'border-primary text-primary'
                : 'border-transparent text-fg-muted hover:text-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'approved' && (
        <Card variant="solid">
          <CardHeader>
            <CardTitle>已发布能力</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {approvedQuery.isLoading ? (
              <div className="space-y-2 p-5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : approvedItems.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-fg-subtle">📭 暂无已发布能力</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-fg-muted">
                    <th className="px-5 py-2 text-left font-medium">名称</th>
                    <th className="px-5 py-2 text-left font-medium">类型</th>
                    <th className="px-5 py-2 text-left font-medium">状态</th>
                    <th className="px-5 py-2 text-left font-medium">提交时间</th>
                    <th className="px-5 py-2 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {approvedItems.map((cap) => (
                    <tr key={cap.id} className="border-b border-border last:border-0 odd:bg-muted/20 transition-colors hover:bg-muted/40">
                      <td className="px-5 py-3 font-medium">{cap.name}</td>
                      <td className="px-5 py-3">
                        <TypeBadge type={cap.type} />
                      </td>
                      <td className="px-5 py-3">
                        <StatusBadge status={cap.status} />
                      </td>
                      <td className="px-5 py-3 text-fg-muted">
                        {format(new Date(cap.createdAt), 'yyyy-MM-dd', { locale: zhCN })}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem>
                              <Edit className="mr-2 h-4 w-4" />
                              编辑
                            </DropdownMenuItem>
                            <DropdownMenuItem className="text-red-600">
                              <Trash2 className="mr-2 h-4 w-4" />
                              删除
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      )}

      {tab === 'all' && (
        <Card variant="solid">
          <CardHeader>
            <CardTitle>全部能力</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {allQuery.isLoading ? (
              <div className="space-y-2 p-5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : allItems.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-fg-subtle">📭 暂无数据</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-fg-muted">
                    <th className="px-5 py-2 text-left font-medium">名称</th>
                    <th className="px-5 py-2 text-left font-medium">类型</th>
                    <th className="px-5 py-2 text-left font-medium">状态</th>
                    <th className="px-5 py-2 text-left font-medium">提交时间</th>
                    <th className="px-5 py-2 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {allItems.map((cap) => (
                    <tr key={cap.id} className="border-b border-border last:border-0 odd:bg-muted/20 transition-colors hover:bg-muted/40">
                      <td className="px-5 py-3 font-medium">{cap.name}</td>
                      <td className="px-5 py-3">
                        <TypeBadge type={cap.type} />
                      </td>
                      <td className="px-5 py-3">
                        <StatusBadge status={cap.status} />
                      </td>
                      <td className="px-5 py-3 text-fg-muted">
                        {format(new Date(cap.createdAt), 'yyyy-MM-dd', { locale: zhCN })}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem>
                              <Edit className="mr-2 h-4 w-4" />
                              编辑
                            </DropdownMenuItem>
                            <DropdownMenuItem className="text-red-600">
                              <Trash2 className="mr-2 h-4 w-4" />
                              删除
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
