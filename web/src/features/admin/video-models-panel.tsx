'use client';

import { useState } from 'react';
import { ZodError } from 'zod';
import { Import, Loader2, Pencil, RefreshCw, Save, ScanSearch, ShieldCheck, Video } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api-client';
import {
  useCreateVideoProfile, useDiscoverVideoModels, useUpdateVideoProfile, useVerifyVideoProfile, useVideoProfiles,
  type CreateMediaVideoProfileDto, type MediaVideoModelDiscovery, type MediaVideoOperation, type MediaVideoProfile,
} from './use-video-config';

function errorText(error: unknown) {
  if (error instanceof ZodError) return error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
  return error instanceof ApiError ? error.message : '请求失败，请稍后重试';
}

const listFields = [
  ['durationsSeconds', '视频时长（秒）'], ['aspectRatios', '视频画幅'],
  ['resolutions', '视频分辨率'], ['frameRates', '视频帧率'], ['outputFormats', '视频输出格式'],
] as const;
type ListField = typeof listFields[number][0];
type ListInputs = Record<ListField, string>;

export function VideoModelsPanel() {
  const profiles = useVideoProfiles();
  const discovery = useDiscoverVideoModels();
  const create = useCreateVideoProfile();
  const update = useUpdateVideoProfile();
  const verify = useVerifyVideoProfile();
  const [editing, setEditing] = useState<MediaVideoProfile | null>(null);
  const [form, setForm] = useState<CreateMediaVideoProfileDto | null>(null);
  const [lists, setLists] = useState<ListInputs>({ durationsSeconds: '', aspectRatios: '', resolutions: '', frameRates: '', outputFormats: '' });
  const [actionError, setActionError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const saving = create.isPending || update.isPending;
  const busy = saving || verify.isPending || discovery.isPending || profiles.isFetching;

  const openForm = (value: CreateMediaVideoProfileDto, profile: MediaVideoProfile | null) => {
    setEditing(profile);
    setForm(value);
    setLists(Object.fromEntries(listFields.map(([key]) => [key, value.capabilities[key].join(', ')])) as ListInputs);
    setFormError(null);
  };
  const importCandidate = (candidate: MediaVideoModelDiscovery['models'][number]) => {
    if (busy || !candidate.suggested) return;
    openForm({
      profileId: candidate.modelId.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 128),
      kind: 'video', displayName: candidate.displayName, modelId: candidate.modelId,
      ...candidate.suggested, enabled: false,
    }, null);
  };
  const editProfile = (profile: MediaVideoProfile) => {
    openForm({
      profileId: profile.profileId, kind: 'video', displayName: profile.displayName, modelId: profile.modelId,
      operations: profile.operations, executionMode: profile.executionMode, capabilities: profile.capabilities, enabled: false,
    }, profile);
  };
  const reportError = (error: unknown) => { setActionError(errorText(error)); toast.error(errorText(error)); };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form || saving) return;
    setFormError(null);
    const split = (key: ListField) => lists[key].split(',').map((value) => value.trim()).filter(Boolean);
    const capabilities = {
      ...form.capabilities, durationsSeconds: split('durationsSeconds').map(Number), aspectRatios: split('aspectRatios'),
      resolutions: split('resolutions') as CreateMediaVideoProfileDto['capabilities']['resolutions'],
      frameRates: split('frameRates').map(Number), outputFormats: split('outputFormats') as CreateMediaVideoProfileDto['capabilities']['outputFormats'],
    };
    try {
      if (editing) {
        await update.mutateAsync({ profileId: editing.profileId, dto: {
          expectedConfigVersion: editing.configVersion, displayName: form.displayName, modelId: form.modelId,
          operations: form.operations, executionMode: form.executionMode, capabilities, enabled: false,
        } });
      } else await create.mutateAsync({ ...form, capabilities, enabled: false });
      setForm(null);
      setActionError(null);
      toast.success('视频 Profile 已保存，请重新校验后启用');
    } catch (error) { setFormError(errorText(error)); toast.error(errorText(error)); }
  };

  return <section aria-labelledby="video-models-title" className="min-w-0 space-y-5 border-t border-border pt-6">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2"><Video className="h-4 w-4" /><h2 id="video-models-title" className="text-base font-semibold">视频模型配置</h2></div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={busy} onClick={() => { setActionError(null); void profiles.refetch(); }}><RefreshCw className="h-4 w-4" />刷新视频配置</Button><Button variant="outline" loading={discovery.isPending} disabled={busy} title={busy ? '正在处理视频配置，请稍候' : '仅发现候选配置，不调用真实视频模型'} onClick={() => { setActionError(null); discovery.mutate(); }}><ScanSearch className="h-4 w-4" />发现视频模型</Button></div>
    </header>
    <p className="text-sm text-fg-muted">配置校验不执行视频生成；已适配的模型校验通过后可启用。</p>
    {discovery.isPending && <p role="status" aria-label="发现视频模型中" className="text-sm text-fg-muted">正在发现视频候选模型…</p>}
    {verify.isPending && <p role="status" aria-label="校验视频配置中" className="text-sm text-fg-muted">正在校验视频配置，未执行视频生成…</p>}
    {(actionError || discovery.error) && <p role="alert" className="break-words text-sm text-danger">{actionError ?? errorText(discovery.error)}</p>}
    {discovery.data && <section aria-label="视频候选模型" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold">视频候选模型</h3><time className="text-xs text-fg-muted" dateTime={discovery.data.checkedAt}>{new Date(discovery.data.checkedAt).toLocaleString('zh-CN')}</time></div>
      {discovery.data.models.length === 0 ? <p className="text-sm text-fg-muted">未发现视频候选模型</p> : <ul className="divide-y divide-border border-y border-border">{discovery.data.models.map((candidate) => <li key={candidate.modelId} className="flex flex-wrap items-center justify-between gap-3 py-3">
        <div className="min-w-0 flex-1 basis-48"><div className="flex flex-wrap items-center gap-2"><span className="break-all text-sm font-medium">{candidate.displayName}</span><Badge variant="secondary">{!candidate.compatible ? '未适配 · 不可启用' : candidate.modelId === 'mock-video-v1' ? 'Mock · 不计费' : '真实视频'}</Badge></div><p className="break-all font-mono text-xs text-fg-muted">{candidate.modelId}</p>{candidate.reason && <p className="break-words text-sm text-fg-muted">{candidate.reason}</p>}</div>
        <div className="space-y-1"><Button size="sm" variant="outline" aria-label={`导入视频模型 ${candidate.displayName}`} disabled={busy || !candidate.suggested} title={candidate.suggested ? '仅导入禁用的配置，不执行模型' : '缺少视频规格，暂不可导入'} onClick={() => importCandidate(candidate)}><Import className="h-4 w-4" />导入</Button>{!candidate.suggested && <p className="text-xs text-fg-muted">缺少视频规格，暂不可导入</p>}</div>
      </li>)}</ul>}
    </section>}
    {profiles.isLoading ? <div role="status" aria-label="加载视频 Profiles"><Loader2 className="h-5 w-5 animate-spin" /></div>
      : profiles.error ? <div className="flex flex-wrap items-center gap-3"><p role="alert" className="text-sm text-danger">{errorText(profiles.error)}</p><Button size="sm" variant="outline" onClick={() => void profiles.refetch()}><RefreshCw className="h-4 w-4" />重试视频配置</Button></div>
        : !profiles.data?.length ? <p className="border border-dashed border-border px-5 py-8 text-sm text-fg-muted">暂无视频 Profile，请先发现并导入模型。</p>
          : <ul aria-label="视频 Profiles" className="divide-y divide-border border-y border-border">{profiles.data.filter((profile) => profile.kind === 'video').map((profile) => {
            const mock = profile.modelId === 'mock-video-v1';
            const adapted = mock || profile.modelId === 'minimax-h3';
            return <li key={profile.profileId} className="flex flex-wrap items-center justify-between gap-3 py-4">
              <div className="min-w-0 flex-1 basis-56"><div className="flex flex-wrap items-center gap-2"><h3 className="break-words text-sm font-medium">{profile.displayName}</h3><Badge variant="secondary">{mock ? 'Mock · 不计费' : '真实视频'}</Badge></div><p className="break-all font-mono text-xs text-fg-muted">{profile.profileId} · {profile.modelId}</p><p className="break-words text-xs text-fg-muted">{profile.operations.join(' / ')} · {profile.capabilities.durationsSeconds.join(' / ')} 秒 · {profile.capabilities.resolutions.join(' / ')} · {profile.capabilities.aspectRatios.join(' / ')}</p><p className="mt-1 text-xs text-fg-muted">{!adapted ? '真实模型未适配，不可启用' : profile.verified ? '配置已校验（未执行视频生成）' : '配置未校验，校验后可启用'}</p></div>
              <div className="flex flex-wrap items-center gap-2"><Switch aria-label={`启用视频 ${profile.displayName}`} checked={profile.enabled} disabled={busy || !profile.enabled && (!profile.verified || !adapted)} onCheckedChange={(enabled) => {
                if (busy || enabled && (!adapted || !profile.verified)) return;
                setActionError(null);
                update.mutate({ profileId: profile.profileId, dto: { expectedConfigVersion: profile.configVersion, enabled } }, { onError: reportError, onSuccess: () => toast.success(enabled ? mock ? 'Mock 视频已启用（不计费）' : '真实视频已启用' : '视频已禁用') });
              }} /><span className="text-sm">{profile.enabled ? '启用' : '禁用'}</span>
                <Button size="icon" variant="ghost" aria-label={`校验视频 ${profile.displayName}`} title="配置校验，不执行视频生成" disabled={busy || !adapted} onClick={() => { setActionError(null); verify.mutate({ profileId: profile.profileId, dto: { expectedConfigVersion: profile.configVersion } }, { onError: reportError, onSuccess: () => toast.success('视频配置已校验，未执行视频生成') }); }}><ShieldCheck className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" aria-label={`编辑视频 ${profile.displayName}`} title="编辑视频配置" disabled={busy} onClick={() => editProfile(profile)}><Pencil className="h-4 w-4" /></Button>
              </div>
            </li>;
          })}</ul>}
    <Dialog open={!!form} onOpenChange={(open) => { if (!open && !saving) setForm(null); }}>
      <DialogContent aria-describedby={undefined} className="max-h-[90dvh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>{editing ? '编辑视频 Profile' : '导入视频 Profile'}</DialogTitle></DialogHeader>
        {form && <form onSubmit={submit} className="space-y-4">
          <p className="text-sm text-fg-muted">保存后保持禁用，需要重新校验。{form.modelId === 'mock-video-v1' ? 'Mock 不计费。' : '真实视频执行会产生费用。'}</p>
          <fieldset disabled={saving} className="min-w-0 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2"><label className="min-w-0 text-sm"><span className="mb-1 block">视频 Profile ID</span><Input required disabled={!!editing} value={form.profileId} onChange={(event) => setForm({ ...form, profileId: event.target.value })} /></label><label className="min-w-0 text-sm"><span className="mb-1 block">视频显示名称</span><Input required value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} /></label></div>
            <label className="block text-sm"><span className="mb-1 block">视频 Model ID</span><Input required value={form.modelId} onChange={(event) => setForm({ ...form, modelId: event.target.value })} /></label>
            <fieldset><legend className="mb-2 text-sm font-medium">视频操作</legend><div className="flex flex-wrap gap-4">{(['image-to-video', 'text-to-video'] as MediaVideoOperation[]).map((operation) => <label key={operation} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.operations.includes(operation)} onChange={(event) => { const operations = event.target.checked ? [...form.operations, operation] : form.operations.filter((value) => value !== operation); setForm({ ...form, operations, capabilities: { ...form.capabilities, supportsImageToVideo: operations.includes('image-to-video'), supportsTextToVideo: operations.includes('text-to-video') } }); }} />{operation}</label>)}</div></fieldset>
            <div className="grid gap-4 sm:grid-cols-2">{listFields.map(([key, label]) => <label key={key} className="min-w-0 text-sm"><span className="mb-1 block">{label}</span><Input required value={lists[key]} onChange={(event) => setLists({ ...lists, [key]: event.target.value })} /></label>)}
              {([['maxInputBytes', '视频输入上限（字节）'], ['maxReferenceCount', '视频参考图上限'], ['resultRetentionSeconds', '视频结果保留（秒）']] as const).map(([key, label]) => <label key={key} className="min-w-0 text-sm"><span className="mb-1 block">{label}</span><Input required type="number" value={form.capabilities[key]} onChange={(event) => setForm({ ...form, capabilities: { ...form.capabilities, [key]: Number(event.target.value) } })} /></label>)}
            </div>
            <div className="flex flex-wrap gap-4">{([['supportsAudio', '视频支持音频'], ['supportsCancel', '视频支持取消']] as const).map(([key, label]) => <label key={key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.capabilities[key]} onChange={(event) => setForm({ ...form, capabilities: { ...form.capabilities, [key]: event.target.checked } })} />{label}</label>)}</div>
          </fieldset>
          {formError && <p role="alert" className="break-words text-sm text-danger">{formError}</p>}
          <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={saving} onClick={() => setForm(null)}>取消</Button><Button type="submit" loading={saving}><Save className="h-4 w-4" />保存视频配置</Button></div>
        </form>}
      </DialogContent>
    </Dialog>
  </section>;
}
