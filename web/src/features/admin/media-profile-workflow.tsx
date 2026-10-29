'use client';

import { useState } from 'react';
import { Check, Plus, Power, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MediaImageSpecV3Schema, MediaVideoSpecV3Schema } from 'shared/media-spec.dto';
import { useCreateMediaProfile, useUpdateMediaProfile, useVerifyMediaProfile, type MediaProfile } from './use-media-config';
import { useCreateVideoProfile, useUpdateVideoProfile, useVerifyVideoProfile, type MediaVideoProfile } from './use-video-config';

interface Props {
  kind: 'image' | 'video';
  model: { modelId: string; displayName: string };
  profile?: MediaProfile | MediaVideoProfile;
}

export function MediaProfileWorkflow({ kind, model, profile }: Props) {
  const imageCreate = useCreateMediaProfile();
  const imageVerify = useVerifyMediaProfile();
  const imageUpdate = useUpdateMediaProfile();
  const videoCreate = useCreateVideoProfile();
  const videoVerify = useVerifyVideoProfile();
  const videoUpdate = useUpdateVideoProfile();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const busy = [imageCreate, imageVerify, imageUpdate, videoCreate, videoVerify, videoUpdate].some(mutation => mutation.isPending);
  const edit = (key: string, value: string) => setDraft(current => ({ ...current, [key]: value }));
  const fail = (failure: unknown) => setError(failure instanceof Error ? failure.message : '操作失败');
  const enable = async () => {
    if (!profile) return;
    setError(null);
    try {
      const input = { profileId: profile.profileId, dto: { expectedConfigVersion: profile.configVersion, enabled: true } };
      if (kind === 'image') await imageUpdate.mutateAsync(input);
      else await videoUpdate.mutateAsync(input);
    } catch (failure) { fail(failure); }
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      if (kind === 'image') {
        const spec = MediaImageSpecV3Schema.parse({ size: draft.size, count: Number(draft.count), quality: draft.quality });
        if (profile) await imageVerify.mutateAsync({ profileId: profile.profileId,
          dto: { expectedConfigVersion: profile.configVersion, verificationSpec: spec } });
        else await imageCreate.mutateAsync({ profileId: draft.profileId, displayName: draft.displayName, kind: 'image',
          modelId: model.modelId, executionMode: 'sync-response', enabled: false,
          operations: draft.operation === 'edit' ? ['edit'] : ['generate'],
          capabilities: { sizes: [spec.size!], maxOutputs: spec.count!, supportsReferenceImage: draft.operation === 'edit' } });
      } else {
        const spec = MediaVideoSpecV3Schema.parse({ durationSeconds: Number(draft.durationSeconds),
          resolution: draft.resolution,
          ...(draft.aspectRatio ? { aspectRatio: draft.aspectRatio } : {}),
          ...(draft.frameRate ? { frameRate: Number(draft.frameRate) } : {}),
          ...(draft.audio ? { audio: draft.audio === 'true' } : {}),
          ...(draft.outputFormat ? { outputFormat: draft.outputFormat } : {}) });
        if (profile) await videoVerify.mutateAsync({ profileId: profile.profileId,
          dto: { expectedConfigVersion: profile.configVersion, verificationSpec: spec } });
        else await videoCreate.mutateAsync({ profileId: draft.profileId, displayName: draft.displayName, kind: 'video',
          modelId: model.modelId, executionMode: 'async-query', enabled: false,
          operations: draft.operation === 'image-to-video' ? ['image-to-video'] : ['text-to-video'],
          capabilities: { supportsTextToVideo: draft.operation === 'text-to-video', supportsImageToVideo: draft.operation === 'image-to-video',
            supportsAudio: spec.audio!, durationsSeconds: [spec.durationSeconds!], aspectRatios: [spec.aspectRatio!],
            resolutions: [spec.resolution!], frameRates: [spec.frameRate!], outputFormats: [spec.outputFormat as 'video/mp4' | 'video/webm'],
            maxInputBytes: 10 * 1024 * 1024, maxReferenceCount: draft.operation === 'image-to-video' ? 1 : 0,
            supportsTaskQuery: true, supportsCancel: false, resultRetentionSeconds: 86400 } });
      }
      setOpen(false);
    } catch (failure) { fail(failure); }
  };
  const field = (key: string, label: string, numeric = false, required = true) => <label key={key} className="min-w-0 text-xs">{label}
    <Input required={required} type={numeric ? 'number' : 'text'} min={numeric ? 1 : undefined} step={numeric ? 'any' : undefined}
      value={draft[key] ?? ''} disabled={busy} onChange={event => edit(key, event.target.value)} /></label>;
  return <div className="min-w-0 w-full space-y-2">
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" disabled={busy} onClick={() => setOpen(value => !value)}>
        {profile ? <ShieldCheck className="h-4 w-4" /> : <Plus className="h-4 w-4" />}{profile ? '报价校验' : '配置通用 Profile'}</Button>
      {profile?.verified && !profile.enabled && <Button size="sm" variant="outline" disabled={busy} onClick={() => void enable()}><Power className="h-4 w-4" />启用</Button>}
    </div>
    {open && <form onSubmit={submit} aria-label={profile ? '报价校验配置' : '创建通用 Profile'} className="grid min-w-0 gap-3 border-t border-border pt-3 sm:grid-cols-2">
      <p className="break-all text-xs text-fg-muted sm:col-span-2">模型：{model.modelId} · 通用 {kind === 'image' ? '同步图片' : '异步视频'} 协议 · 仅报价校验，不执行生成</p>
      {!profile && <>{field('profileId', 'Profile ID')}{field('displayName', '显示名称')}
        <label className="text-xs">操作<select required value={draft.operation ?? ''} onChange={event => edit('operation', event.target.value)} className="mt-1 block w-full border border-border bg-background p-2">
          <option value="">请选择</option>{(kind === 'image' ? ['generate', 'edit'] : ['text-to-video', 'image-to-video']).map(operation => <option key={operation}>{operation}</option>)}
        </select></label></>}
      {kind === 'image' ? <>{field('size', '尺寸 size')}{field('count', '输出数量', true)}{field('quality', '质量 quality')}</>
        : <>{field('durationSeconds', '时长（秒）', true)}{field('resolution', '分辨率')}{field('aspectRatio', '画幅比例', false, !profile)}{field('frameRate', '帧率', true, !profile)}
          <label className="text-xs">音频<select required={!profile} value={draft.audio ?? ''} onChange={event => edit('audio', event.target.value)} className="mt-1 block w-full border border-border bg-background p-2"><option value="">{profile ? '不指定' : '请选择'}</option><option value="true">有音频</option><option value="false">无音频</option></select></label>
          <label className="text-xs">输出格式<select required={!profile} value={draft.outputFormat ?? ''} onChange={event => edit('outputFormat', event.target.value)} className="mt-1 block w-full border border-border bg-background p-2"><option value="">{profile ? '不指定' : '请选择'}</option><option>video/mp4</option><option>video/webm</option></select></label></>}
      <Button size="sm" type="submit" disabled={busy}><Check className="h-4 w-4" />{profile ? '校验报价合同' : '创建停用 Profile'}</Button>
    </form>}
    {error && <p role="alert" className="break-words text-xs text-danger">{error}</p>}
  </div>;
}
