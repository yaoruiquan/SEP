'use client';

import { useEffect, useState } from 'react';
import { Image, RefreshCw, ScanSearch, Save, Video } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api-client';
import type { MediaConnection } from './use-media-config';
import type { UpdateMediaConnectionDto } from 'shared/media.dto';

interface ProfileStatus {
  profileId: string;
  configVersion: string;
  displayName: string;
  modelId: string;
  enabled: boolean;
  verified: boolean;
}
interface DiscoveryModel { modelId: string; displayName: string; compatible: boolean; reason: string | null }
interface Props {
  kind: 'image' | 'video';
  connection: { data?: MediaConnection; isLoading: boolean; error: Error | null; refetch: () => Promise<unknown> };
  save: { isPending: boolean; mutateAsync: (dto: UpdateMediaConnectionDto) => Promise<unknown> };
  discovery: {
    data?: { checkedAt: string; models: DiscoveryModel[]; mock?: boolean };
    error: Error | null; isPending: boolean; reset: () => void; mutate: () => void;
  };
  profiles: { data?: ProfileStatus[]; isLoading: boolean; error: Error | null };
  updating: boolean;
  onDisable: (profile: ProfileStatus) => Promise<unknown>;
}
const errorText = (error: unknown) => error instanceof ApiError ? error.message : '请求失败，请稍后重试';
const sourceLabels = { database: '后台保存', environment: '环境变量', unconfigured: '未配置' };

export function MediaModelsPanelView({ kind, connection, save, discovery, profiles, updating, onDisable }: Props) {
  const name = kind === 'image' ? '图片' : '视频';
  const Icon = kind === 'image' ? Image : Video;
  const [form, setForm] = useState({ baseUrl: '', apiKey: '' });
  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState('');
  const busy = save.isPending || discovery.isPending || updating;
  useEffect(() => {
    if (connection.data && !dirty) setForm({ baseUrl: connection.data.baseUrl, apiKey: '' });
  }, [connection.data, dirty]);
  const edit = (field: 'baseUrl' | 'apiKey', value: string) => {
    setDirty(true);
    setForm((current) => ({ ...current, [field]: value }));
    discovery.reset();
    setSaveError('');
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setSaveError('');
    discovery.reset();
    try {
      await save.mutateAsync(form);
      setDirty(false);
      setForm((current) => ({ ...current, apiKey: '' }));
      toast.success(`${name}连接已保存，请检测并同步模型`);
    } catch (error) { setSaveError(errorText(error)); }
  };
  const disable = async (profile: ProfileStatus) => {
    try { await onDisable(profile); toast.success(`${profile.displayName} 已停用`); }
    catch (error) { toast.error(errorText(error)); }
  };
  const saved = profiles.data ?? [];
  const found = discovery.data?.models;
  const candidates = (found ?? []).filter((model) => !saved.some((profile) => profile.modelId === model.modelId));

  return <section aria-labelledby={`${kind}-models-title`} className="min-w-0 space-y-5">
    <header className="flex flex-wrap items-center gap-2">
      <Icon className="h-4 w-4"/><h2 id={`${kind}-models-title`} className="text-base font-semibold">{name}模型</h2>
      {connection.data && <><Badge variant={connection.data.configured ? 'default' : 'secondary'}>{connection.data.configured ? '已配置' : '未配置'}</Badge>
        <span className="text-xs text-fg-muted">来源：{sourceLabels[connection.data.source ?? 'unconfigured']}</span></>}
    </header>
    <form onSubmit={submit} className="grid min-w-0 gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
      <label className="min-w-0 text-sm"><span className="mb-1 block font-medium">Base URL</span>
        <Input required type="url" disabled={busy} value={form.baseUrl} onChange={(event) => edit('baseUrl', event.target.value)}/></label>
      <label className="min-w-0 text-sm"><span className="mb-1 block font-medium">API Key {connection.data?.apiKeyConfigured && <span className="text-fg-muted">(已保存，留空不修改)</span>}</span>
        <Input type="password" autoComplete="new-password" disabled={busy} value={form.apiKey} onChange={(event) => edit('apiKey', event.target.value)}/></label>
      <Button type="submit" loading={save.isPending} disabled={busy}><Save className="h-4 w-4"/>保存连接</Button>
      {dirty && <p className="text-sm text-fg-muted sm:col-span-3">请先保存连接，再检测模型。</p>}
      {saveError && <p role="alert" className="break-words text-sm text-danger sm:col-span-3">{saveError}</p>}
      {connection.error && <div className="flex flex-wrap items-center gap-2 text-sm text-danger sm:col-span-3">
        <span role="alert">连接状态读取失败：{errorText(connection.error)}。可填写完整新连接后保存。</span>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void connection.refetch()}><RefreshCw className="h-4 w-4"/>重试</Button></div>}
      {connection.isLoading && <p role="status" className="text-sm text-fg-muted sm:col-span-3">正在读取连接状态</p>}
    </form>
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
      <h3 className="text-sm font-semibold">已同步模型</h3>
      <Button variant="outline" size="sm" loading={discovery.isPending} disabled={busy || dirty || !connection.data?.configured || !!connection.error}
        onClick={() => discovery.mutate()}><ScanSearch className="h-4 w-4"/>检测并同步</Button>
    </div>
    <p className="text-xs text-fg-muted">检测不执行生成，也不自动授权企业。生成规格在客户端选择，价格按实际规格报价。</p>
    {discovery.data && <p className="text-xs text-fg-muted">检测时间：{new Date(discovery.data.checkedAt).toLocaleString()}{discovery.data.mock ? ' · mock 检测' : ''} · 本次未验收真实生成</p>}
    {discovery.error && <p role="alert" className="break-words text-sm text-danger">{errorText(discovery.error)}</p>}
    {profiles.error && <p role="alert" className="break-words text-sm text-danger">模型状态读取失败：{errorText(profiles.error)}</p>}
    {found?.length === 0 && <p role="status" className="text-sm text-fg-muted">本次目录未发现{name}模型，历史配置仍保留。</p>}
    <ul className="divide-y divide-border border-y border-border">
      {saved.map((profile) => <li key={profile.profileId} className="flex flex-wrap items-center justify-between gap-3 py-3">
        <div className="min-w-0 flex-1 basis-48"><p className="break-words text-sm font-medium">{profile.displayName}</p>
          <p className="break-all font-mono text-xs text-fg-muted">{profile.modelId}</p>
          {found && !found.some((model) => model.modelId === profile.modelId) && <p className="text-xs text-fg-muted">本次目录未发现此模型</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{profile.verified ? '已适配' : '待重新检测 / 配置不兼容'}</Badge>
          <Badge variant={profile.enabled && profile.verified ? 'default' : 'secondary'}>{!profile.enabled ? '已停用' : profile.verified ? '启用中' : '暂不可用'}</Badge>
          {profile.enabled && <Button size="sm" variant="outline" disabled={busy} onClick={() => void disable(profile)}>紧急停用</Button>}
        </div>
      </li>)}
      {candidates.map((model) => <li key={`candidate:${model.modelId}`} className="flex flex-wrap items-center justify-between gap-3 py-3">
        <div className="min-w-0 flex-1 basis-48"><p className="break-words text-sm font-medium">{model.displayName}</p>
          <p className="break-all font-mono text-xs text-fg-muted">{model.modelId}</p>
          {model.reason && <p className="break-words text-xs text-fg-muted">{model.reason}</p>}
        </div><Badge variant="secondary">{model.compatible ? '未生成可用配置，请检查历史限制' : '未知 / 未适配'}</Badge>
      </li>)}
      {!saved.length && !candidates.length && <li className="py-6 text-sm text-fg-muted">{profiles.isLoading ? '正在读取已同步模型' : discovery.isPending ? '检测中' : '尚无同步模型'}</li>}
    </ul>
  </section>;
}
