'use client';

import { useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Trash2, Loader2, Copy, Check } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
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
  DialogDescription,
} from '@/components/ui/dialog';
import { CenteredSpinner } from '@/components/ui/feedback';
import {
  useApiKeys,
  useCreateApiKey,
  useRevokeApiKey,
} from '@/features/enterprise-settings/use-enterprise-settings';
import type { CreateApiKeyResponse } from '@/features/enterprise-settings/use-enterprise-settings';
import type { ApiError } from '@/lib/api-client';

const API_KEY_SCOPES = ['chat:read', 'knowledge:read', 'instances:read'] as const;
const SCOPE_LABELS: Record<string, string> = {
  'chat:read': '对话（读）',
  'knowledge:read': '知识库（读）',
  'instances:read': '硅基员工（读）',
};

const createKeySchema = z.object({
  name: z.string().min(1, '名称不能为空').max(100),
  scopes: z.array(z.string()).min(1, '至少选择一个权限'),
  expiresAt: z.string().optional(),
});

type FormValues = z.infer<typeof createKeySchema>;

export default function ApiKeysPage() {
  const { data: keys, isLoading } = useApiKeys();
  const createKey = useCreateApiKey();
  const revokeKey = useRevokeApiKey();

  const [open, setOpen] = useState(false);
  const [newKey, setNewKey] = useState<CreateApiKeyResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(createKeySchema),
    defaultValues: { name: '', scopes: [], expiresAt: '' },
  });

  const onSubmit = form.handleSubmit((values) => {
    createKey.mutate(
      {
        name: values.name,
        scopes: values.scopes as any,
        expiresAt: values.expiresAt || undefined,
      },
      {
        onSuccess: (res) => {
          setOpen(false);
          form.reset();
          setNewKey(res);
        },
      },
    );
  });

  const copyKey = async () => {
    if (!newKey) return;
    await navigator.clipboard.writeText(newKey.key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (isLoading) return <CenteredSpinner label="加载中…" />;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">API 密钥</h1>
          <p className="mt-1 text-sm text-fg-muted">
            管理企业 API 密钥，密钥创建后明文仅展示一次。
          </p>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" />
          新建密钥
        </Button>
      </div>

      {/* Key list */}
      <div className="space-y-3">
        {keys?.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-sm text-fg-muted">
              暂无 API 密钥
            </CardContent>
          </Card>
        )}
        {keys?.map((key) => (
          <Card key={key.id} className={key.revokedAt ? 'opacity-60' : ''}>
            <CardHeader className="flex flex-row items-center justify-between py-3">
              <div className="flex items-center gap-2">
                <CardTitle className="font-mono text-sm">{key.keyPrefix}…</CardTitle>
                <span className="text-sm font-medium text-foreground">{key.name}</span>
                {key.active ? (
                  <Badge variant="glass-success" className="text-xs">有效</Badge>
                ) : key.revokedAt ? (
                  <Badge variant="glass-danger" className="text-xs">已吊销</Badge>
                ) : (
                  <Badge variant="default" className="text-xs text-fg-muted border border-glassline">已过期</Badge>
                )}
              </div>
              {key.active && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-danger hover:text-danger"
                  onClick={() => {
                    if (confirm(`确认吊销密钥「${key.name}」？此操作不可撤销。`)) {
                      revokeKey.mutate(key.id);
                    }
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </CardHeader>
            <CardContent className="pb-4 pt-0">
              <div className="flex flex-wrap gap-1.5">
                {key.scopes.map((s) => (
                  <Badge key={s} variant="glass" className="text-xs">
                    {SCOPE_LABELS[s] ?? s}
                  </Badge>
                ))}
              </div>
              <div className="mt-2 flex gap-4 text-xs text-fg-muted">
                <span>
                  创建于{' '}
                  {formatDistanceToNow(new Date(key.createdAt), {
                    addSuffix: true,
                    locale: zhCN,
                  })}
                </span>
                {key.lastUsedAt && (
                  <span>
                    最近使用{' '}
                    {formatDistanceToNow(new Date(key.lastUsedAt), {
                      addSuffix: true,
                      locale: zhCN,
                    })}
                  </span>
                )}
                {key.expiresAt && (
                  <span>到期 {new Date(key.expiresAt).toLocaleDateString('zh-CN')}</span>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Create dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建 API 密钥</DialogTitle>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                名称
              </label>
              <Input {...form.register('name')} placeholder="如：生产环境集成" />
              {form.formState.errors.name && (
                <p className="mt-1 text-sm text-danger">
                  {form.formState.errors.name.message}
                </p>
              )}
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-foreground">
                权限范围
              </label>
              <Controller
                control={form.control}
                name="scopes"
                render={({ field }) => (
                  <div className="space-y-1.5">
                    {API_KEY_SCOPES.map((scope) => {
                      const checked = field.value.includes(scope);
                      return (
                        <label
                          key={scope}
                          className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              field.onChange(
                                checked
                                  ? field.value.filter((s) => s !== scope)
                                  : [...field.value, scope],
                              );
                            }}
                          />
                          {SCOPE_LABELS[scope]}
                        </label>
                      );
                    })}
                  </div>
                )}
              />
              {form.formState.errors.scopes && (
                <p className="mt-1 text-sm text-danger">
                  {form.formState.errors.scopes.message}
                </p>
              )}
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                到期日期（可选）
              </label>
              <Input type="date" {...form.register('expiresAt')} />
            </div>
            {createKey.error && (
              <p className="text-sm text-danger">
                {(createKey.error as ApiError).message || '创建失败'}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                取消
              </Button>
              <Button type="submit" disabled={createKey.isPending}>
                {createKey.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                创建
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* New key reveal dialog */}
      {newKey && (
        <Dialog open onOpenChange={() => setNewKey(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>API 密钥已创建</DialogTitle>
              <DialogDescription>
                请立即复制并妥善保管。此密钥只会出现一次，关闭后无法再次查看。
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2">
              <code className="flex-1 break-all font-mono text-sm">{newKey.key}</code>
              <Button
                size="sm"
                variant="ghost"
                onClick={copyKey}
                className="shrink-0"
              >
                {copied ? (
                  <Check className="h-4 w-4 text-success" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
            <DialogFooter>
              <Button onClick={() => setNewKey(null)}>我已保存，关闭</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
