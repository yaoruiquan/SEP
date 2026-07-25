'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CenteredSpinner } from '@/components/ui/feedback';
import { toast } from '@/components/ui/toast';
import { useSettings, useUpdateSettings } from '@/features/admin/use-admin';
import { useUpstreamModels } from '@/features/model/use-models';

export default function SettingsPage() {
  const { data: settings, isLoading } = useSettings();
  const update = useUpdateSettings();
  const {
    data: models,
    refetch: refetchModels,
    isFetching: modelsFetching,
    error: modelsError,
  } = useUpstreamModels();

  // 本地编辑态：key -> 输入值
  const [edits, setEdits] = useState<Record<string, string>>({});

  // settings 加载后，用非敏感项的现值初始化输入框（敏感项留空=不改）
  useEffect(() => {
    if (!settings) return;
    const init: Record<string, string> = {};
    for (const s of settings) {
      init[s.key] = s.secret ? '' : (s.value ?? '');
    }
    setEdits(init);
  }, [settings]);

  if (isLoading) return <CenteredSpinner label="加载设置…" />;

  const handleSave = async () => {
    // 只提交有改动的项：非敏感项全提交；敏感项仅当填了新值才提交
    const payload: Record<string, string> = {};
    for (const s of settings ?? []) {
      const v = edits[s.key] ?? '';
      if (s.secret) {
        if (v.trim() !== '') payload[s.key] = v.trim();
      } else {
        payload[s.key] = v.trim();
      }
    }
    try {
      await update.mutateAsync(payload);
      toast.success('设置已保存');
    } catch (e) {
      toast.error(`保存失败：${(e as Error).message}`);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <h1 className="text-xl font-semibold">系统设置</h1>

      <Card>
        <CardHeader>
          <CardTitle>上游渠道（sub2api）</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {settings?.map((s) => (
            <div key={s.key}>
              <label className="text-xs font-medium text-fg-muted">
                {s.label}
                {s.secret && s.configured && (
                  <span className="ml-2 text-success">已配置</span>
                )}
              </label>
              <Input
                type={s.secret ? 'password' : 'text'}
                value={edits[s.key] ?? ''}
                placeholder={s.secret ? '留空则不修改' : ''}
                onChange={(e) =>
                  setEdits((prev) => ({ ...prev, [s.key]: e.target.value }))
                }
              />
            </div>
          ))}

          <div className="flex items-center gap-2 pt-2">
            <Button onClick={handleSave} disabled={update.isPending}>
              {update.isPending ? '保存中…' : '保存'}
            </Button>
            <Button
              variant="secondary"
              onClick={() => refetchModels()}
              disabled={modelsFetching}
            >
              {modelsFetching ? '测试中…' : '测试连接'}
            </Button>
            {modelsError ? (
              <span className="text-sm text-danger">
                ✗ {(modelsError as Error).message}
              </span>
            ) : models ? (
              <span className="text-sm text-success">
                ✓ 上游可用，共 {models.length} 个模型
              </span>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
