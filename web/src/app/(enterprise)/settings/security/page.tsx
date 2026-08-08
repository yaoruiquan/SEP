'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { CenteredSpinner } from '@/components/ui/feedback';
import {
  useEnterpriseSetting,
  useUpdateEnterpriseSetting,
} from '@/features/enterprise-settings/use-enterprise-settings';
import type { ApiError } from '@/lib/api-client';

const securitySchema = z.object({
  sensitiveWordsEnabled: z.boolean(),
  sensitiveWords: z.string(), // comma-separated in UI
  ipWhitelist: z.string(),    // comma-separated in UI
  sessionTimeoutMinutes: z.coerce.number().int().min(5).max(10080),
  forcePasswordRotationDays: z.string(), // empty = no rotation
});

type FormValues = z.infer<typeof securitySchema>;

export default function SecurityPage() {
  const { data: setting, isLoading } = useEnterpriseSetting();
  const update = useUpdateEnterpriseSetting();

  const form = useForm<FormValues>({
    resolver: zodResolver(securitySchema),
    values: setting
      ? {
          sensitiveWordsEnabled: setting.sensitiveWordsEnabled,
          sensitiveWords: setting.sensitiveWords.join(', '),
          ipWhitelist: setting.ipWhitelist.join(', '),
          sessionTimeoutMinutes: setting.sessionTimeoutMinutes,
          forcePasswordRotationDays: setting.forcePasswordRotationDays
            ? String(setting.forcePasswordRotationDays)
            : '',
        }
      : undefined,
  });

  const onSubmit = form.handleSubmit((values) => {
    const splitTrim = (s: string) =>
      s
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);

    update.mutate({
      sensitiveWordsEnabled: values.sensitiveWordsEnabled,
      sensitiveWords: splitTrim(values.sensitiveWords),
      ipWhitelist: splitTrim(values.ipWhitelist),
      sessionTimeoutMinutes: values.sessionTimeoutMinutes,
      forcePasswordRotationDays: values.forcePasswordRotationDays
        ? Number(values.forcePasswordRotationDays)
        : null,
    });
  });

  if (isLoading) return <CenteredSpinner label="加载中…" />;

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">安全策略</h1>
        <p className="mt-1 text-sm text-fg-muted">
          配置企业的内容过滤、IP 白名单和会话安全策略
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-6">
        {/* Sensitive Words */}
        <Card>
          <CardHeader>
            <CardTitle>敏感词过滤</CardTitle>
            <CardDescription>
              开启后，对话中包含以下词汇的消息将被拦截。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">启用敏感词过滤</span>
              <Switch
                checked={form.watch('sensitiveWordsEnabled')}
                onCheckedChange={(v) => form.setValue('sensitiveWordsEnabled', v)}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                敏感词列表（逗号分隔）
              </label>
              <Input
                {...form.register('sensitiveWords')}
                placeholder="词汇1, 词汇2, 词汇3"
                disabled={!form.watch('sensitiveWordsEnabled')}
              />
            </div>
          </CardContent>
        </Card>

        {/* IP Whitelist */}
        <Card>
          <CardHeader>
            <CardTitle>IP 白名单</CardTitle>
            <CardDescription>
              留空表示不限制。填写后仅允许列表内的 IP 地址访问企业资源。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Input
              {...form.register('ipWhitelist')}
              placeholder="192.168.1.0/24, 10.0.0.1"
            />
          </CardContent>
        </Card>

        {/* Session */}
        <Card>
          <CardHeader>
            <CardTitle>会话与密码</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                会话超时（分钟）
              </label>
              <Input
                type="number"
                {...form.register('sessionTimeoutMinutes')}
                className="w-40"
              />
              {form.formState.errors.sessionTimeoutMinutes && (
                <p className="mt-1 text-sm text-danger">
                  {form.formState.errors.sessionTimeoutMinutes.message}
                </p>
              )}
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                强制密码轮换（天，留空表示不强制）
              </label>
              <Input
                type="number"
                {...form.register('forcePasswordRotationDays')}
                placeholder="90"
                className="w-40"
              />
            </div>
          </CardContent>
        </Card>

        {update.error && (
          <p className="text-sm text-danger">
            {(update.error as ApiError).message || '保存失败'}
          </p>
        )}
        {update.isSuccess && (
          <p className="text-sm text-success">设置已保存</p>
        )}

        <Button type="submit" disabled={update.isPending || !form.formState.isDirty}>
          {update.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          保存设置
        </Button>
      </form>
    </div>
  );
}
