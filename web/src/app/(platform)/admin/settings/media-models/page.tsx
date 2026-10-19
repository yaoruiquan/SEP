'use client';

import { useEffect, useState } from 'react';
import { ZodError } from 'zod';
import { Image, Import, KeyRound, Loader2, Pencil, Plus, RefreshCw, Save, ScanSearch, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api-client';
import {
  useCreateMediaProfile, useMediaConnection, useMediaProfiles, useUpdateMediaConnection,
  useUpdateMediaProfile, type CreateImageProfileDto, type MediaProfile, type MediaOperation,
  useDiscoverMediaModels, useVerifyMediaProfile, type MediaModelDiscovery, type UpdateImageProfileDto,
} from '@/features/admin/use-media-config';

const emptyForm: CreateImageProfileDto = {
  profileId: '', kind: 'image', displayName: '', modelId: '', operations: ['generate'],
  executionMode: 'sync-response',
  capabilities: { supportsReferenceImage: false, maxOutputs: 1, sizes: ['1024x1024'] },
  enabled: false,
};

function errorText(error: unknown) {
  if (error instanceof ZodError) return error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
  return error instanceof ApiError ? error.message : '请求失败，请稍后重试';
}

export default function MediaModelsPage() {
  const profiles = useMediaProfiles();
  const connection = useMediaConnection();
  const saveConnection = useUpdateMediaConnection();
  const create = useCreateMediaProfile();
  const update = useUpdateMediaProfile();
  const discovery = useDiscoverMediaModels();
  const verify = useVerifyMediaProfile();
  const [connectionForm, setConnectionForm] = useState({ baseUrl: '', apiKey: '' });
  const [form, setForm] = useState<CreateImageProfileDto>(emptyForm);
  const [sizesText, setSizesText] = useState('1024x1024');
  const [editing, setEditing] = useState<MediaProfile | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const savingProfile = create.isPending || update.isPending;
  const busy = savingProfile || verify.isPending || saveConnection.isPending;
  const imageProfiles = profiles.data?.filter((profile) => profile.kind === 'image') ?? [];

  useEffect(() => {
    if (connection.data) setConnectionForm({ baseUrl: connection.data.baseUrl, apiKey: '' });
  }, [connection.data]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setSizesText('1024x1024');
    setFormError(null);
    setDialogOpen(true);
  };

  const openEdit = (profile: MediaProfile) => {
    setEditing(profile);
    setForm({
      profileId: profile.profileId, kind: 'image', displayName: profile.displayName,
      modelId: profile.modelId, operations: profile.operations, executionMode: profile.executionMode,
      capabilities: profile.capabilities, enabled: profile.enabled,
    });
    setSizesText(profile.capabilities.sizes.join(', '));
    setFormError(null);
    setDialogOpen(true);
  };

  const selectCandidate = (candidate: MediaModelDiscovery['models'][number]) => {
    if (!candidate.compatible || !candidate.suggested) return;
    setEditing(null);
    setForm({
      ...emptyForm,
      profileId: candidate.modelId.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[^a-z0-9]+/, '').slice(0, 64),
      displayName: candidate.displayName,
      modelId: candidate.modelId,
      ...candidate.suggested,
      enabled: false,
    });
    setSizesText(candidate.suggested.capabilities.sizes.join(', '));
    setFormError(null);
    setDialogOpen(true);
  };

  const submitProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    if (savingProfile) return;
    setFormError(null);
    const capabilities = {
      ...form.capabilities,
      sizes: sizesText.split(',').map((size) => size.trim()).filter(Boolean),
    };
    try {
      if (editing) {
        const dto: UpdateImageProfileDto = {
          expectedConfigVersion: editing.configVersion,
          displayName: form.displayName, modelId: form.modelId, operations: form.operations,
          executionMode: form.executionMode, capabilities, enabled: form.enabled,
        };
        await update.mutateAsync({ profileId: editing.profileId, dto });
        toast.success('图片 Profile 已更新');
      } else {
        await create.mutateAsync({ ...form, capabilities, enabled: false });
        toast.success('图片 Profile 已创建');
      }
      setDialogOpen(false);
      setEditing(null);
    } catch (error) {
      setFormError(errorText(error));
      toast.error(errorText(error));
    }
  };

  const saveConnectionForm = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || discovery.isPending) return;
    setConnectionError(null);
    try {
      await saveConnection.mutateAsync(connectionForm);
      discovery.reset();
      verify.reset();
      toast.success('媒体连接已保存');
      setConnectionForm((current) => ({ ...current, apiKey: '' }));
    } catch (error) {
      setConnectionError(errorText(error));
      toast.error(errorText(error));
    }
  };

  const toggleEnabled = (profile: MediaProfile, enabled: boolean) => {
    if (busy || (enabled && !profile.verified)) return;
    update.mutate({
      profileId: profile.profileId,
      dto: { expectedConfigVersion: profile.configVersion, enabled },
    }, {
      onSuccess: () => toast.success(enabled ? '图片 Profile 已启用' : '图片 Profile 已禁用'),
      onError: (error) => toast.error(errorText(error)),
    });
  };

  const verifyProfile = (profile: MediaProfile) => {
    if (busy) return;
    verify.mutate({ profileId: profile.profileId, dto: { expectedConfigVersion: profile.configVersion } }, {
      onSuccess: () => toast.success('配置已校验'),
      onError: (error) => toast.error(errorText(error)),
    });
  };

  return <div className="space-y-6 p-4 sm:p-6">
    <header><h1 className="text-2xl font-bold">图片模型配置</h1></header>
    <section className="border-b border-border pb-6">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <KeyRound className="h-4 w-4" /><h2 className="text-base font-semibold">媒体连接</h2>
        {connection.data && <Badge variant={connection.data.configured ? 'default' : 'secondary'}>{connection.data.configured ? '已配置' : '未配置'}</Badge>}
      </div>
      {connection.isLoading ? <div role="status" aria-label="加载媒体连接"><Loader2 className="h-5 w-5 animate-spin" /></div>
        : connection.error ? <div className="flex flex-wrap items-center gap-3"><p role="alert" className="text-sm text-danger">{errorText(connection.error)}</p><Button variant="outline" size="sm" onClick={() => void connection.refetch()}><RefreshCw className="h-4 w-4" />重试</Button></div>
          : <form className="grid max-w-3xl gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end" onSubmit={saveConnectionForm}>
            <label className="min-w-0 text-sm"><span className="mb-1 block font-medium">Base URL</span><Input required type="url" disabled={saveConnection.isPending} value={connectionForm.baseUrl} onChange={(e) => setConnectionForm({ ...connectionForm, baseUrl: e.target.value })} /></label>
            <label className="min-w-0 text-sm"><span className="mb-1 block font-medium">API Key {connection.data?.apiKeyConfigured && <span className="text-fg-muted">（已保存）</span>}</span><Input type="password" autoComplete="new-password" disabled={saveConnection.isPending} value={connectionForm.apiKey} onChange={(e) => setConnectionForm({ ...connectionForm, apiKey: e.target.value })} /></label>
            <Button type="submit" loading={saveConnection.isPending} disabled={busy || discovery.isPending}><Save className="h-4 w-4" />保存连接</Button>
            {connectionError && <p role="alert" className="break-words text-sm text-danger md:col-span-3">{connectionError}</p>}
          </form>}
    </section>
    <section className="border-b border-border pb-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2"><h2 className="text-base font-semibold">候选模型</h2>{discovery.data && <time className="text-xs text-fg-muted" dateTime={discovery.data.checkedAt}>检测于 {new Date(discovery.data.checkedAt).toLocaleString('zh-CN')}</time>}</div>
        <Button variant="outline" loading={discovery.isPending} disabled={busy || discovery.isPending || !connection.data?.configured || connection.isError} title={connection.data?.configured ? '检测已保存媒体连接中的模型，不保存或执行生图' : '请先保存有效的媒体连接'} onClick={() => discovery.mutate()}><ScanSearch className="h-4 w-4" />检测候选模型</Button>
      </div>
      {discovery.isPending && <div role="status" aria-label="检测候选模型" className="flex items-center gap-2 text-sm text-fg-muted"><Loader2 className="h-4 w-4 animate-spin" />检测中</div>}
      {discovery.error && <p role="alert" className="break-words text-sm text-danger">{errorText(discovery.error)}</p>}
      {!discovery.isPending && discovery.data && (discovery.data.models.length === 0 ? <p className="text-sm text-fg-muted">未发现候选模型</p> : <ul className="divide-y divide-border border-y border-border">
        {discovery.data.models.map((candidate) => {
          const selectable = candidate.compatible && !!candidate.suggested;
          return <li key={candidate.modelId} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0 flex-1 basis-48"><div className="flex flex-wrap items-center gap-2"><span className="break-all font-medium text-sm">{candidate.displayName}</span><Badge variant={selectable ? 'default' : 'secondary'}>{selectable ? '兼容' : candidate.reason ? '不兼容' : '兼容性未知'}</Badge></div><div className="break-all font-mono text-xs text-fg-muted">{candidate.modelId}</div>{candidate.reason && <p className="mt-1 break-words text-sm text-fg-muted">{candidate.reason}</p>}</div>
            <Button variant="outline" size="sm" aria-label={`选用 ${candidate.displayName}`} title={selectable ? '预填图片 Profile' : candidate.reason ?? '未确认兼容性，不能选用'} disabled={!selectable || busy} onClick={() => selectCandidate(candidate)}><Import className="h-4 w-4" />选用</Button>
          </li>;
        })}
      </ul>)}
    </section>
    <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="text-base font-semibold">图片 Profiles</h2><Button disabled={busy} onClick={openCreate}><Plus className="h-4 w-4" />添加</Button></div>
      {profiles.isLoading ? <div role="status" aria-label="加载图片 Profiles"><Loader2 className="h-5 w-5 animate-spin" /></div>
        : profiles.error ? <div className="flex flex-wrap items-center gap-3"><p role="alert" className="text-sm text-danger">{errorText(profiles.error)}</p><Button variant="outline" size="sm" onClick={() => void profiles.refetch()}><RefreshCw className="h-4 w-4" />重试</Button></div>
          : imageProfiles.length === 0 ? <div className="border border-dashed border-border py-12 text-center"><Image className="mx-auto h-8 w-8 text-fg-muted" /><p className="mt-3 text-sm text-fg-muted">暂无图片 Profile</p></div>
            : <div className="overflow-x-auto border border-border"><table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-border bg-muted/40"><tr><th className="p-3">名称</th><th className="p-3">模型</th><th className="p-3">操作</th><th className="p-3">状态</th><th className="p-3 text-right">操作</th></tr></thead>
              <tbody>{imageProfiles.map((profile) => <tr className="border-b border-border last:border-0" key={profile.profileId}>
                <td className="max-w-56 break-words p-3"><div className="font-medium">{profile.displayName}</div><div className="font-mono text-xs text-fg-muted">{profile.profileId}</div></td>
                <td className="max-w-56 break-words p-3"><div>{profile.modelId}</div><div className="text-xs text-fg-muted">{profile.executionMode}</div></td>
                <td className="p-3">{profile.operations.join(' / ')}</td>
                <td className="p-3"><div className="flex items-center gap-2" title={!profile.verified && !profile.enabled ? '配置校验后可启用' : undefined}><Switch checked={profile.enabled} disabled={busy || (!profile.verified && !profile.enabled)} aria-label={`启用 ${profile.displayName}`} onCheckedChange={(enabled) => toggleEnabled(profile, enabled)} /><span>{profile.enabled ? '启用' : '禁用'}</span></div><div className="mt-1 text-xs text-fg-muted">{profile.verified ? '配置已校验' : '配置未校验'}</div>{verify.error && verify.variables?.profileId === profile.profileId && <p role="alert" className="mt-1 max-w-56 break-words text-xs text-danger">{errorText(verify.error)}</p>}</td>
                <td className="p-3 text-right"><div className="flex justify-end gap-1"><Button variant="ghost" size="icon" title="配置校验：adapter、模型可见性及全部操作/尺寸/质量的只读报价，不执行生图" aria-label={`配置校验 ${profile.displayName}`} disabled={busy || !connection.data?.configured || connection.isError} onClick={() => verifyProfile(profile)}>{verify.isPending && verify.variables?.profileId === profile.profileId ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}</Button><Button variant="ghost" size="icon" title="编辑" aria-label={`编辑 ${profile.displayName}`} disabled={busy} onClick={() => openEdit(profile)}><Pencil className="h-4 w-4" /></Button></div></td>
              </tr>)}</tbody>
            </table></div>}
    </section>
    <Dialog open={dialogOpen} onOpenChange={(open) => { if (!savingProfile) setDialogOpen(open); }}>
      <DialogContent aria-describedby={undefined} className="max-h-[90dvh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>{editing ? '编辑图片 Profile' : '添加图片 Profile'}</DialogTitle></DialogHeader>
        <form className="space-y-4" onSubmit={submitProfile}>
          <fieldset disabled={savingProfile} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="min-w-0 text-sm"><span className="mb-1 block font-medium">Profile ID</span><Input required pattern="[a-z0-9][a-z0-9._-]{1,63}" maxLength={64} disabled={!!editing} value={form.profileId} onChange={(e) => setForm({ ...form, profileId: e.target.value })} /></label>
              <label className="min-w-0 text-sm"><span className="mb-1 block font-medium">显示名称</span><Input required maxLength={80} value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} /></label>
            </div>
            <label className="block text-sm"><span className="mb-1 block font-medium">Model ID</span><Input required maxLength={160} value={form.modelId} onChange={(e) => setForm({ ...form, modelId: e.target.value })} /></label>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="min-w-0 text-sm"><span className="mb-1 block font-medium">执行模式</span><select className="h-10 w-full rounded border border-border bg-card px-3 text-sm" value={form.executionMode} onChange={(e) => setForm({ ...form, executionMode: e.target.value as CreateImageProfileDto['executionMode'] })}><option value="sync-response">sync-response</option><option value="async-query">async-query</option></select></label>
              <label className="min-w-0 text-sm"><span className="mb-1 block font-medium">最大输出数</span><Input required type="number" min={1} max={8} step={1} value={form.capabilities.maxOutputs ?? 1} onChange={(e) => setForm({ ...form, capabilities: { ...form.capabilities, maxOutputs: Number(e.target.value) } })} /></label>
            </div>
            <fieldset><legend className="mb-2 text-sm font-medium">允许操作</legend><div className="flex flex-wrap gap-4">{(['generate', 'edit'] as MediaOperation[]).map((operation) => <label className="flex items-center gap-2 text-sm" key={operation}><input type="checkbox" checked={form.operations.includes(operation)} onChange={(e) => setForm({ ...form, operations: e.target.checked ? [...new Set([...form.operations, operation])] : form.operations.filter((item) => item !== operation) })} />{operation}</label>)}</div></fieldset>
            <label className="flex items-center gap-2 text-sm"><Switch checked={form.capabilities.supportsReferenceImage ?? false} onCheckedChange={(supportsReferenceImage) => setForm({ ...form, capabilities: { ...form.capabilities, supportsReferenceImage } })} />支持参考图</label>
            <label className="block text-sm"><span className="mb-1 block font-medium">支持尺寸</span><Input required placeholder="1024x1024, 1536x1024" value={sizesText} onChange={(e) => setSizesText(e.target.value)} /></label>
          </fieldset>
          {formError && <p role="alert" className="break-words text-sm text-danger">{formError}</p>}
          <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={savingProfile} onClick={() => setDialogOpen(false)}>取消</Button><Button type="submit" loading={savingProfile}><Save className="h-4 w-4" />保存</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  </div>;
}
