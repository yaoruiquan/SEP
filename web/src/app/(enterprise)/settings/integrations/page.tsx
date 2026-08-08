'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  useEnterpriseSetting,
  useUpdateEnterpriseSetting,
} from '@/features/enterprise-settings/use-enterprise-settings';
import { Loader2, Eye, EyeOff, Save, Webhook, Shield } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────

export default function IntegrationsPage() {
  const { data: setting, isLoading } = useEnterpriseSetting();
  const update = useUpdateEnterpriseSetting();

  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [saved, setSaved] = useState(false);

  // Hydrate local state when setting loads
  useEffect(() => {
    if (setting) {
      setWebhookUrl(setting.webhookUrl ?? '');
      // Secret is write-only — never pre-fill from server
      setWebhookSecret('');
    }
  }, [setting]);

  function handleSaveWebhook() {
    const dto: { webhookUrl?: string; webhookSecret?: string } = {};
    dto.webhookUrl = webhookUrl || undefined;
    if (webhookSecret) dto.webhookSecret = webhookSecret;

    update.mutate(dto as any, {
      onSuccess: () => {
        setSaved(true);
        setWebhookSecret('');
        setTimeout(() => setSaved(false), 2500);
      },
    });
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-16 text-fg-muted">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>加载中…</span>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* ── Webhook ──────────────────────────────────────────────────────── */}
      <section>
        <div className="mb-4 flex items-center gap-2">
          <Webhook className="h-5 w-5 text-primary" />
          <h2 className="text-base font-semibold">Webhook</h2>
        </div>

        <div className="rounded-xl border border-border bg-card p-6 space-y-5">
          <p className="text-sm text-fg-muted">
            配置 Webhook 后，系统将在会话完成等事件时向您的端点发送 HTTP POST 请求。
          </p>

          {/* URL */}
          <div className="space-y-1.5">
            <Label htmlFor="webhook-url">Endpoint URL</Label>
            <Input
              id="webhook-url"
              type="url"
              placeholder="https://your-server.com/hooks/sep"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
            />
          </div>

          {/* Secret */}
          <div className="space-y-1.5">
            <Label htmlFor="webhook-secret">
              Signing Secret
              <span className="ml-1.5 text-xs text-fg-muted">（留空表示不修改）</span>
            </Label>
            <div className="relative">
              <Input
                id="webhook-secret"
                type={showSecret ? 'text' : 'password'}
                placeholder="••••••••••••••••"
                value={webhookSecret}
                onChange={(e) => setWebhookSecret(e.target.value)}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowSecret((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-muted hover:text-foreground"
              >
                {showSecret ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
            <p className="text-xs text-fg-muted">
              用于验证 webhook 请求的 HMAC-SHA256 签名密钥，保存后不会再次展示。
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Button
              onClick={handleSaveWebhook}
              disabled={update.isPending}
            >
              {update.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              保存
            </Button>
            {saved && (
              <span className="text-sm text-green-500">已保存 ✓</span>
            )}
            {setting?.webhookUrl && (
              <Badge variant="glass-success" className="text-xs">
                已配置
              </Badge>
            )}
          </div>
        </div>
      </section>

      {/* ── SSO (Phase 8 placeholder) ─────────────────────────────────────── */}
      <section>
        <div className="mb-4 flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          <h2 className="text-base font-semibold">单点登录 (SSO)</h2>
          <Badge variant="glass-warning" className="text-xs">即将推出</Badge>
        </div>

        <div className="rounded-xl border border-border bg-card p-6 space-y-4">
          <p className="text-sm text-fg-muted">
            支持通过 SAML 2.0 / OIDC 协议接入企业身份提供商（IdP），统一管理员工认证。
          </p>
          <ul className="list-disc list-inside space-y-1 text-sm text-fg-muted">
            <li>支持 Okta、Azure AD、Google Workspace 等主流 IdP</li>
            <li>SCIM 2.0 自动同步成员目录</li>
            <li>强制 SSO 登录策略（禁用密码登录）</li>
          </ul>
          <Button variant="outline" disabled className="cursor-default opacity-50">
            配置 SSO（Phase 8 可用）
          </Button>
        </div>
      </section>
    </div>
  );
}
