'use client';

import { useState } from 'react';
import { ZodError } from 'zod';
import { Loader2, Plus, RefreshCw, Save, ScanSearch, Video } from 'lucide-react';
import { MediaVideoPolicySchema } from 'shared/media-video-config.dto';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';
import { MediaPolicyPreview } from './media-policy-preview';
import {
  VideoPolicyFormSchema, useAvailableVideoProfiles, useEnterpriseVideoConfig, useUpdateEnterpriseVideoConfig, usePreviewEnterpriseVideoConfig,
  type MediaVideoOperation, type MediaVideoPolicy,
} from './use-video-config';

function errorText(error: unknown) {
  if (error instanceof ZodError) return error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
  return error instanceof ApiError ? error.message : '请求失败，请稍后重试';
}

export function VideoPolicyPanel() {
  const { enterprise, isAdmin } = useAuth();
  const enterpriseId = enterprise?.id ?? '';
  const config = useEnterpriseVideoConfig(enterpriseId);
  const available = useAvailableVideoProfiles(enterpriseId);
  const save = useUpdateEnterpriseVideoConfig(enterpriseId);
  const preview = usePreviewEnterpriseVideoConfig();
  const [draft, setDraft] = useState<{ enterpriseId: string; policy: MediaVideoPolicy } | null>(null);
  const [ratioDraft, setRatioDraft] = useState<{ enterpriseId: string; value: string } | null>(null);
  const [failure, setFailure] = useState<{ enterpriseId: string; message: string } | null>(null);
  const policy = draft?.enterpriseId === enterpriseId ? draft.policy : config.data?.policy ?? null;
  const ratioInput = ratioDraft?.enterpriseId === enterpriseId ? ratioDraft.value : '';
  const previewMatches = preview.variables?.enterpriseId === enterpriseId && preview.variables.policy === policy;
  const previewPending = previewMatches && preview.isPending;
  const saveError = failure?.enterpriseId === enterpriseId ? failure.message : null;
  const profiles = available.data ?? [];
  const unavailableIds = (policy?.enabledProfileIds ?? []).filter((id) => !profiles.some((profile) => profile.profileId === id));
  const canEdit = Boolean(enterpriseId && isAdmin && config.data?.canEdit);
  const mock = config.data?.mock;
  const update = (next: Partial<MediaVideoPolicy>) => {
    if (!canEdit || save.isPending || !policy || !config.data) return;
    setDraft({ enterpriseId, policy: { ...policy, ...next } });
  };
  const addRatio = () => {
    if (!canEdit || !policy || save.isPending) return;
    const ratio = ratioInput.trim();
    if (!MediaVideoPolicySchema.safeParse({ allowedAspectRatios: [ratio] }).success) {
      setFailure({ enterpriseId, message: '画幅格式应为正整数比例，例如 21:9' });
      return;
    }
    update({ allowedAspectRatios: [...new Set([...policy.allowedAspectRatios, ratio])] });
    setRatioDraft(null);
    setFailure(null);
  };
  const toggleProfile = (profileId: string, checked: boolean) => {
    if (!policy) return;
    update({
      enabledProfileIds: checked ? [...new Set([...policy.enabledProfileIds, profileId])] : policy.enabledProfileIds.filter((id) => id !== profileId),
      defaultProfileId: !checked && policy.defaultProfileId === profileId ? null : policy.defaultProfileId,
    });
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!policy || !canEdit || save.isPending) return;
    setFailure(null);
    try {
      const { periodBudget: _periodBudget, ...editablePolicy } = policy;
      const saved = await save.mutateAsync(VideoPolicyFormSchema.parse(editablePolicy));
      setDraft((current) => current?.enterpriseId === enterpriseId ? null : current);
      preview.reset();
      toast.success(saved.mock ? '视频授权策略已保存（Mock 不计费）' : '真实视频授权策略已保存');
    } catch (error) { setFailure({ enterpriseId, message: errorText(error) }); toast.error(errorText(error)); }
  };
  const error = config.error;
  const aspectRatios = [...new Set([...profiles.flatMap((profile) => profile.capabilities.aspectRatios), ...(policy?.allowedAspectRatios ?? [])])];

  return <section aria-labelledby="video-policy-title" className="min-w-0 space-y-5 border-t border-border pt-6">
    <header className="flex flex-wrap items-center gap-2"><Video className="h-4 w-4" /><h2 id="video-policy-title" className="text-base font-semibold">视频授权</h2>{mock !== undefined && <Badge variant="secondary">{mock ? 'Mock · 不计费' : '真实视频'}</Badge>}</header>
    <p className="text-sm text-fg-muted">视频授权独立于聊天和图片配置。</p>
    {!enterpriseId ? <p className="text-sm text-fg-muted">请先选择企业。</p>
      : config.isLoading ? <div role="status" aria-label="加载视频授权"><Loader2 className="h-5 w-5 animate-spin" /></div>
        : error ? <div className="flex flex-wrap items-center gap-3"><p role="alert" className="text-sm text-danger">{errorText(error)}</p><Button variant="outline" size="sm" onClick={() => { void config.refetch(); void available.refetch(); }}><RefreshCw className="h-4 w-4" />重试视频授权</Button></div>
          : !policy ? <p className="text-sm text-fg-muted">暂无视频授权策略</p> : <>
            {!canEdit && <p className="border border-border bg-muted/30 px-4 py-3 text-sm text-fg-muted">当前为只读视图，视频授权由企业管理员维护。</p>}
            {!config.data?.configured && <p className="border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">平台{mock ? ' Mock ' : ''}视频尚未开放或没有已启用且已校验的视频 Profile。</p>}
            {available.error && <div className="flex flex-wrap items-center gap-2 text-sm"><p role="alert">能力目录加载失败：{errorText(available.error)}。仍可保存授权。</p><Button type="button" variant="outline" size="sm" onClick={() => { void available.refetch(); }}><RefreshCw className="h-4 w-4" />刷新目录</Button></div>}
            <form aria-label="视频授权策略" className="max-w-3xl space-y-5" onSubmit={submit}>
              <fieldset disabled={!canEdit || save.isPending} className="min-w-0 space-y-5">
                <fieldset className="space-y-2"><legend className="mb-3 text-sm font-medium">允许的视频 Profile</legend>
                  {!profiles.length && !unavailableIds.length && <p className="border border-dashed border-border px-5 py-8 text-sm text-fg-muted">暂无已启用且已校验的视频 Profile</p>}
                  {profiles.map((profile) => <label key={profile.profileId} className="flex items-start gap-3 border border-border px-4 py-3 text-sm"><input type="checkbox" checked={policy.enabledProfileIds.includes(profile.profileId)} onChange={(event) => toggleProfile(profile.profileId, event.target.checked)} /><span className="min-w-0 break-words"><span className="block font-medium">{profile.displayName}</span><span className="block text-xs text-fg-muted">{profile.profileId} · {profile.operations.join(' / ')} · {profile.capabilities.durationsSeconds.join(' / ')} 秒 · {profile.capabilities.resolutions.join(' / ')} · {profile.capabilities.aspectRatios.join(' / ')}</span></span></label>)}
                  {unavailableIds.map((id) => <label key={id} className="flex items-start gap-3 border border-dashed border-amber-300 px-4 py-3 text-sm"><input type="checkbox" checked onChange={() => toggleProfile(id, false)} /><span className="min-w-0 break-all">{id}<span className="block text-xs text-amber-800">当前不可用，请移除或等待平台恢复</span></span></label>)}
                </fieldset>
                <div className="grid gap-4 border-t border-border pt-5 sm:grid-cols-2">
                  <label className="min-w-0 text-sm"><span className="mb-1 block font-medium">默认视频 Profile</span><select className="h-10 w-full rounded border border-border bg-card px-3 text-sm" value={policy.defaultProfileId ?? ''} onChange={(event) => update({ defaultProfileId: event.target.value || null })}><option value="">不设置默认</option>{policy.enabledProfileIds.map((id) => <option value={id} key={id}>{profiles.find((profile) => profile.profileId === id)?.displayName ?? `${id}（不可用）`}</option>)}</select></label>
                  <label className="min-w-0 text-sm"><span className="mb-1 block font-medium">视频最大时长（秒）</span><Input required type="number" step={1} value={policy.maxDurationSeconds} onChange={(event) => update({ maxDurationSeconds: Number(event.target.value) })} /></label>
                  <label className="min-w-0 text-sm"><span className="mb-1 block font-medium">视频最高分辨率</span><Input required list="video-policy-resolutions" value={policy.maxResolution} onChange={(event) => update({ maxResolution: event.target.value })} /><datalist id="video-policy-resolutions">{[...new Set([...profiles.flatMap((profile) => profile.capabilities.resolutions), policy.maxResolution])].map((resolution) => <option value={resolution} key={resolution} />)}</datalist></label>
                  <label className="min-w-0 text-sm"><span className="mb-1 block font-medium">视频最大并发任务</span><Input required type="number" step={1} value={policy.maxConcurrentJobs} onChange={(event) => update({ maxConcurrentJobs: Number(event.target.value) })} /></label>
                  <p className="text-xs text-fg-muted sm:col-span-2">{mock ? 'Mock 不产生真实扣费；并发设置仅用于授权策略展示。' : '实际费用以执行前报价和统一资金预占为准；并发任务由服务端限制。'}</p>
                </div>
                <fieldset><legend className="mb-2 text-sm font-medium">允许的视频操作</legend><div className="flex flex-wrap gap-4">{(['image-to-video', 'text-to-video'] as MediaVideoOperation[]).map((operation) => <label key={operation} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={policy.allowedOperations.includes(operation)} onChange={(event) => update({ allowedOperations: event.target.checked ? [...new Set([...policy.allowedOperations, operation])] : policy.allowedOperations.filter((value) => value !== operation) })} />{operation}</label>)}</div></fieldset>
                <fieldset><legend className="mb-2 text-sm font-medium">允许的视频画幅</legend><div className="flex flex-wrap gap-4">{aspectRatios.map((ratio) => <label key={ratio} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={policy.allowedAspectRatios.includes(ratio)} onChange={(event) => update({ allowedAspectRatios: event.target.checked ? [...new Set([...policy.allowedAspectRatios, ratio])] : policy.allowedAspectRatios.filter((value) => value !== ratio) })} />{ratio}</label>)}</div><div className="mt-3 flex max-w-xs items-end gap-2"><label className="min-w-0 flex-1 text-sm"><span className="mb-1 block">新增授权画幅</span><Input value={ratioInput} placeholder="21:9" onChange={(event) => setRatioDraft({ enterpriseId, value: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addRatio(); } }} /></label><Button type="button" size="icon" variant="outline" title="添加画幅" aria-label="添加画幅" onClick={addRatio}><Plus className="h-4 w-4" /></Button></div></fieldset>
              </fieldset>
              {saveError && <p role="alert" className="break-words text-sm text-danger">{saveError}</p>}
              {previewMatches && preview.error && <p role="alert" className="break-words text-sm text-danger">预览失败：{errorText(preview.error)}。仍可保存授权，实际执行前由后台复核。</p>}
              {previewMatches && preview.data && <MediaPolicyPreview preview={preview.data} />}
              {canEdit && <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" disabled={previewPending || save.isPending} loading={previewPending} onClick={() => { void preview.mutateAsync({ enterpriseId, policy }).catch(() => undefined); }}><ScanSearch className="h-4 w-4" />预览当前授权</Button><Button type="submit" loading={save.isPending}><Save className="h-4 w-4" />保存视频策略</Button></div>}
            </form>
          </>}
  </section>;
}
