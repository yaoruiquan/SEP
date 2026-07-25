'use client';

import { useState } from 'react';
import { RefreshCw, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/feedback';
import { toast } from '@/components/ui/toast';
import {
  usePlatformModels,
  useSyncModels,
  useUpdatePlatformModel,
} from '@/features/model/use-models';

export default function ModelsPage() {
  const { data: models, isLoading } = usePlatformModels();
  const sync = useSyncModels();
  const updateModel = useUpdatePlatformModel();
  const [hideDisabled, setHideDisabled] = useState(false);

  const handleSync = async () => {
    try {
      const r = await sync.mutateAsync();
      toast.success(
        `同步完成：上游 ${r.upstreamTotal} 个 · 新增 ${r.added} · 恢复 ${r.restored} · 失效 ${r.staled}`,
      );
    } catch (e) {
      toast.error(`同步失败：${(e as Error).message}`);
    }
  };

  const toggle = (id: string, enabled: boolean, label: string) => {
    updateModel.mutate(
      { id, enabled },
      {
        onSuccess: () =>
          toast.success(`${label} 已${enabled ? '启用' : '停用'}`),
        onError: (e) => toast.error(`操作失败：${(e as Error).message}`),
      },
    );
  };

  const list = (models ?? []).filter((m) => (hideDisabled ? m.enabled : true));
  const enabledCount = (models ?? []).filter((m) => m.enabled && !m.isStale).length;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">可用模型</h1>
          <p className="mt-0.5 text-sm text-fg-muted">
            勾选启用的模型才会出现在用户端的模型选择里
          </p>
        </div>
        <Button onClick={handleSync} disabled={sync.isPending}>
          <RefreshCw className={`h-4 w-4 ${sync.isPending ? 'animate-spin' : ''}`} />
          {sync.isPending ? '同步中…' : '同步上游模型'}
        </Button>
      </div>

      <div className="flex items-center gap-4 text-sm text-fg-muted">
        <span>
          共 {models?.length ?? 0} 个 · 已启用{' '}
          <span className="font-medium text-success">{enabledCount}</span>
        </span>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={hideDisabled}
            onChange={(e) => setHideDisabled(e.target.checked)}
          />
          只看已启用
        </label>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>模型列表</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : list.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-fg-subtle">
              🔌 还没有模型，点右上角「同步上游模型」拉取
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-fg-muted">
                  <th className="px-5 py-2 text-left font-medium">模型 ID</th>
                  <th className="px-5 py-2 text-left font-medium">显示名</th>
                  <th className="px-5 py-2 text-left font-medium">状态</th>
                  <th className="px-5 py-2 text-right font-medium">对用户开放</th>
                </tr>
              </thead>
              <tbody>
                {list.map((m) => (
                  <tr
                    key={m.id}
                    className="border-b border-border last:border-0 odd:bg-muted/20 transition-colors hover:bg-muted/40"
                  >
                    <td className="px-5 py-2.5">
                      <code className="text-[12px] text-fg-muted">{m.modelId}</code>
                    </td>
                    <td className="px-5 py-2.5 font-medium">{m.label}</td>
                    <td className="px-5 py-2.5">
                      {m.isStale ? (
                        <Badge className="bg-warning/10 text-warning">
                          <AlertTriangle className="mr-1 inline h-3 w-3" />
                          上游已下架
                        </Badge>
                      ) : m.enabled ? (
                        <Badge className="bg-success/10 text-success">已启用</Badge>
                      ) : (
                        <Badge className="bg-muted text-fg-subtle">未启用</Badge>
                      )}
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      <label className="inline-flex cursor-pointer items-center">
                        <input
                          type="checkbox"
                          className="h-4 w-4 cursor-pointer accent-primary"
                          checked={m.enabled}
                          disabled={m.isStale || updateModel.isPending}
                          onChange={(e) => toggle(m.id, e.target.checked, m.label)}
                        />
                      </label>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
