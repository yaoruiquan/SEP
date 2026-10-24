'use client';

import { useMemo, useState } from 'react';
import { ZodError } from 'zod';
import { Image, Loader2, RefreshCw, Save, ScanSearch } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';
import { VideoPolicyPanel } from '@/features/enterprise-settings/video-policy-panel';
import { MediaPolicyPreview } from '@/features/enterprise-settings/media-policy-preview';
import {
  MediaPolicyFormSchema, useAvailableMediaProfiles, useEnterpriseMediaConfig, useUpdateEnterpriseMediaConfig, usePreviewEnterpriseMediaConfig,
} from '@/features/enterprise-settings/use-media-config';
import type { MediaOperation, MediaPolicy } from '@/features/enterprise-settings/use-media-config';

function errorText(error: unknown) {
  if (error instanceof ZodError) return error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
  return error instanceof ApiError ? error.message : '请求失败，请稍后重试';
}

export default function MediaSettingsPage() {
  return <><ImageSettingsPanel /><div className="p-4 pb-36 sm:p-6 sm:pb-36 md:pb-6"><VideoPolicyPanel /></div></>;
}

function ImageSettingsPanel() {
  const { enterprise, isAdmin } = useAuth();
  const enterpriseId = enterprise?.id ?? '';
  const config = useEnterpriseMediaConfig(enterpriseId);
  const available = useAvailableMediaProfiles(enterpriseId);
  const save = useUpdateEnterpriseMediaConfig(enterpriseId);
  const preview = usePreviewEnterpriseMediaConfig();
  const [draft, setDraft] = useState<{ enterpriseId: string; policy: MediaPolicy } | null>(null);
  const [failure, setFailure] = useState<{ enterpriseId: string; message: string } | null>(null);
  const policy = draft?.enterpriseId === enterpriseId ? draft.policy : config.data?.policy ?? null;
  const saveError = failure?.enterpriseId === enterpriseId ? failure.message : null;
  const previewMatches = preview.variables?.enterpriseId === enterpriseId && preview.variables.policy === policy;
  const previewPending = previewMatches && preview.isPending;
  const profiles = useMemo(() => available.data ?? [], [available.data]);
  const selectedUnavailable = useMemo(() => (policy?.enabledProfileIds ?? []).filter((id) => !profiles.some((profile) => profile.profileId === id)), [policy, profiles]);
  const canEdit = Boolean(enterpriseId && isAdmin && config.data?.canEdit);

  const update = (next: Partial<MediaPolicy>) => {
    if (policy && canEdit && !save.isPending) setDraft({ enterpriseId, policy: { ...policy, ...next } });
  };
  const toggleProfile = (profileId: string, checked: boolean) => update({
    enabledProfileIds: checked ? [...new Set([...(policy?.enabledProfileIds ?? []), profileId])] : (policy?.enabledProfileIds ?? []).filter((id) => id !== profileId),
    defaultProfileId: !checked && policy?.defaultProfileId === profileId ? null : policy?.defaultProfileId ?? null,
  });
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!policy || !canEdit || save.isPending) return;
    setFailure(null);
    const { video: _video, ...imagePolicy } = policy;
    try {
      await save.mutateAsync(MediaPolicyFormSchema.parse(imagePolicy));
      setDraft((current) => current?.enterpriseId === enterpriseId ? null : current);
      preview.reset();
      toast.success('图片策略已保存');
    }
    catch (error) { setFailure({ enterpriseId, message: errorText(error) }); toast.error(errorText(error)); }
  };

  if (!enterpriseId) return <div className="p-6 text-sm text-fg-muted">请先选择企业。</div>;
  if (config.isLoading) return <div role="status" aria-label="加载图片配置" className="flex h-full items-center justify-center p-10"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  const error = config.error;
  if (error) return <div className="flex flex-wrap items-center gap-3 p-6"><p role="alert" className="text-sm text-danger">{errorText(error)}</p><Button variant="outline" onClick={() => { void config.refetch(); void available.refetch(); }}><RefreshCw className="h-4 w-4" />重试</Button></div>;
  if (!policy) return <div className="p-6 text-sm text-fg-muted">暂无图片策略</div>;

  return <div className="space-y-6 p-4 pb-28 sm:p-6 sm:pb-28 md:pb-6"><header><h1 className="text-2xl font-bold">图片配置</h1></header>
    {!canEdit && <div className="border border-border bg-muted/30 px-4 py-3 text-sm text-fg-muted">当前为只读视图，图片策略由企业管理员维护。</div>}
    {!config.data?.configured && <div className="border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">平台图片连接尚未配置，暂时没有可用的图片 Profile。</div>}
    {available.error && <div className="flex flex-wrap items-center gap-2 text-sm"><p role="alert">能力目录加载失败：{errorText(available.error)}。仍可保存授权。</p><Button type="button" variant="outline" size="sm" onClick={() => { void available.refetch(); }}><RefreshCw className="h-4 w-4" />刷新目录</Button></div>}
    <form className="max-w-3xl space-y-6" onSubmit={submit}>
      <fieldset disabled={!canEdit || save.isPending} className="min-w-0 space-y-6">
      <section>
        <div className="mb-3 flex items-center gap-2"><Image className="h-4 w-4" /><h2 className="font-semibold">允许的 Profile</h2></div>
        {profiles.length === 0 && selectedUnavailable.length === 0
          ? <div className="border border-dashed border-border px-5 py-8 text-sm text-fg-muted">暂无已验证且可用的图片 Profile</div>
          : <div className="space-y-2">
            {profiles.map((profile) => <label className="flex items-start gap-3 border border-border px-4 py-3" key={profile.profileId}>
              <input type="checkbox" disabled={!canEdit} checked={policy.enabledProfileIds.includes(profile.profileId)} onChange={(e) => toggleProfile(profile.profileId, e.target.checked)} />
              <span className="min-w-0 flex-1 break-words"><span className="block font-medium">{profile.displayName}</span><span className="block text-xs text-fg-muted">{profile.profileId} · {profile.operations.join(' / ')} · {profile.capabilities.sizes.join(' / ')} · 最多 {profile.capabilities.maxOutputs} 张</span></span>
            </label>)}
            {selectedUnavailable.map((profileId) => <label className="flex items-start gap-3 border border-dashed border-amber-300 px-4 py-3" key={profileId}>
              <input type="checkbox" disabled={!canEdit} checked onChange={() => toggleProfile(profileId, false)} />
              <span className="min-w-0 break-words"><span className="block font-medium">{profileId}</span><span className="block text-xs text-amber-800">当前不可用</span></span>
            </label>)}
          </div>}
      </section>
      <section className="grid gap-4 border-t border-border pt-6 md:grid-cols-2"><label className="text-sm"><span className="mb-1 block font-medium">默认 Profile</span><select disabled={!canEdit} className="h-10 w-full rounded border border-border bg-white px-3 text-sm" value={policy.defaultProfileId ?? ''} onChange={(e) => update({ defaultProfileId: e.target.value || null })}><option value="">不设置默认</option>{policy.enabledProfileIds.map((id) => <option value={id} key={id}>{id}</option>)}</select></label><label className="text-sm"><span className="mb-1 block font-medium">授权最大输出数</span><Input disabled={!canEdit} type="number" min={1} step={1} value={policy.maxOutputs} onChange={(e) => update({ maxOutputs: Number(e.target.value) })} /></label><label className="text-sm"><span className="mb-1 block font-medium">授权最大宽度</span><Input disabled={!canEdit} type="number" min={1} step={1} value={policy.maxWidth} onChange={(e) => update({ maxWidth: Number(e.target.value) })} /></label><label className="text-sm"><span className="mb-1 block font-medium">授权最大高度</span><Input disabled={!canEdit} type="number" min={1} step={1} value={policy.maxHeight} onChange={(e) => update({ maxHeight: Number(e.target.value) })} /></label></section>
      <fieldset disabled={!canEdit}><legend className="mb-2 text-sm font-medium">允许操作</legend><div className="flex gap-4">{(['generate', 'edit'] as MediaOperation[]).map((operation) => <label className="flex items-center gap-2 text-sm" key={operation}><input type="checkbox" checked={policy.allowedOperations.includes(operation)} onChange={(e) => update({ allowedOperations: e.target.checked ? [...new Set([...policy.allowedOperations, operation])] : policy.allowedOperations.filter((item) => item !== operation) })} />{operation}</label>)}</div></fieldset>
      </fieldset>
      {saveError && <p role="alert" className="break-words text-sm text-danger">{saveError}</p>}
      {previewMatches && preview.error && <p role="alert" className="break-words text-sm text-danger">预览失败：{errorText(preview.error)}。仍可保存授权，实际执行前由后台复核。</p>}
      {previewMatches && preview.data && <MediaPolicyPreview preview={preview.data} />}
      {canEdit && <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" disabled={previewPending || save.isPending} loading={previewPending} onClick={() => { void preview.mutateAsync({ enterpriseId, policy }).catch(() => undefined); }}><ScanSearch className="h-4 w-4" />预览当前授权</Button><Button type="submit" loading={save.isPending}><Save className="h-4 w-4" />保存策略</Button></div>}
    </form>
  </div>;
}
