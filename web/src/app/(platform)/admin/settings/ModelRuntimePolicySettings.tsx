'use client';

import { useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, History, RefreshCw, RotateCcw, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { CenteredSpinner } from '@/components/ui/feedback';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api-client';
import { useAuthStore } from '@/lib/auth-store';
import {
  useModelRuntimePolicy,
  useModelRuntimePolicyHistory,
  useRestoreModelRuntimePolicy,
  useUpdateModelRuntimePolicy,
  type ModelRuntimePolicyAdminView,
  type ModelRuntimePolicyFieldView,
  type ModelRuntimePolicyHistoryItem,
  type ModelRuntimePolicyKey,
} from '@/features/admin/use-model-runtime-policy';
import {
  BUDGET_KEY, buildPolicyUpdates, createPolicyDraft, displayPolicyValue,
  policyImpact, policySourceLabel, policyUnitLabel, rebasePolicyDraft, type PolicyDraft,
} from './model-runtime-policy-form';

const GROUPS = [
  ['client-timeouts', '客户端超时'],
  ['web-planner-timeouts', 'Web 与任务规划超时'],
  ['rates-concurrency', '调用频率与并发'],
  ['output-budget', '输出数量与企业预留预算'],
] as const;

type Confirmation = 'save' | { item: ModelRuntimePolicyHistoryItem; side: 'before' | 'after' } | null;

export default function ModelRuntimePolicySettings() {
  const isAdmin = useAuthStore((state) => state.user?.role === 'ADMIN');
  const query = useModelRuntimePolicy();

  if (!isAdmin) return <p className="text-sm text-fg-muted">仅平台管理员可查看模型运行策略。</p>;
  if (query.error && !query.data) return <div role="alert" className="space-y-3 text-sm text-danger"><p>模型运行策略加载失败：{query.error.message}</p><Button variant="outline" onClick={() => void query.refetch()} loading={query.isFetching}><RefreshCw className="h-4 w-4" />重新加载</Button></div>;
  if (!query.data) return <CenteredSpinner label="加载模型运行策略…" />;

  return <PolicyEditor initialView={query.data} query={query} />;
}

function PolicyEditor({ initialView, query }: { initialView: ModelRuntimePolicyAdminView; query: ReturnType<typeof useModelRuntimePolicy> }) {
  const update = useUpdateModelRuntimePolicy();
  const restore = useRestoreModelRuntimePolicy();
  const [base, setBase] = useState(initialView);
  const [draft, setDraft] = useState<PolicyDraft>(() => createPolicyDraft(initialView));
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [reason, setReason] = useState('');
  const [saveError, setSaveError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [reloaded, setReloaded] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const submitting = useRef(false);

  const saving = update.isPending || restore.isPending;
  const outdated = conflict || (query.data !== undefined && query.data.version !== base.version);
  const writable = base.writeEnabled && query.data?.writeEnabled !== false;
  const { updates, errors } = buildPolicyUpdates(base, draft);
  const dirty = Object.keys(updates).length > 0 || errors.length > 0;
  const disabled = !writable || saving || query.isFetching;

  const change = (field: ModelRuntimePolicyFieldView, value: string) => {
    setDraft((current) => current && ({
      ...current,
      values: { ...current.values, [field.key]: value },
      ...(field.key === BUDGET_KEY ? { budgetMode: 'override' as const } : {}),
    }));
    setSaveError('');
  };

  const clearOverride = (field: ModelRuntimePolicyFieldView) => {
    setDraft((current) => current && ({
      ...current, values: { ...current.values, [field.key]: '' },
      ...(field.key === BUDGET_KEY ? { budgetMode: 'inherit' as const } : {}),
    }));
    setSaveError('');
  };

  const reload = async () => {
    const result = await query.refetch();
    if (!result.data || result.error) {
      setSaveError(`重新加载失败：${result.error?.message ?? '未返回策略'}`);
      return;
    }
    setDraft(rebasePolicyDraft(base, result.data, draft));
    setBase(result.data);
    setConflict(false);
    setReloaded(true);
    setSaveError('');
    setConfirmation(null);
  };

  const confirm = async () => {
    if (!confirmation || submitting.current || saving || outdated || !writable || !reason.trim()) return;
    submitting.current = true;
    setSaveError('');
    try {
      const result = confirmation === 'save'
        ? await update.mutateAsync({ expectedVersion: base.version, updates, reason: reason.trim() })
        : await restore.mutateAsync({ expectedVersion: base.version, historyId: confirmation.item.id, side: confirmation.side, reason: reason.trim() });
      setBase(result);
      setDraft(createPolicyDraft(result));
      setConfirmation(null);
      setReason('');
      setReloaded(false);
      const windowChanged = result.changes.some((item) => item.key === 'GATEWAY_MODEL_RATE_WINDOW_MS');
      toast.success(`已保存，新请求使用版本 ${result.version}；运行中请求保持原策略`, windowChanged ? '当前计数窗口到期后采用新窗口。' : undefined);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setConflict(true);
        setConfirmation(null);
        setSaveError('策略版本冲突，草稿和原因已保留。请重新加载最新策略并核对差异后再保存。');
      } else {
        setSaveError(error instanceof Error ? error.message : '保存失败，请重试');
      }
    } finally {
      submitting.current = false;
    }
  };

  const previewUpdates = confirmation && confirmation !== 'save'
    ? Object.fromEntries(base.fields.map((field) => [field.key, confirmation.item[confirmation.side].overrides[field.key] ?? '']).filter(([key, value]) => value !== base.fields.find((field) => field.key === key)?.value))
    : updates;

  return <div className="min-w-0 space-y-6">
    <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div><h2 className="text-xl font-semibold">模型运行策略</h2><div className="mt-2 flex flex-wrap items-center gap-2 text-sm"><Badge variant="secondary">版本 {base.version}</Badge><span className="text-fg-muted">{dirty ? '有未保存变更' : '无未保存变更'}</span></div></div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => setShowHistory(!showHistory)} aria-expanded={showHistory}><History className="h-4 w-4" />变更历史</Button>
        {writable && <Button disabled={disabled || !dirty || errors.length > 0 || outdated} onClick={() => { setSaveError(''); setConfirmation('save'); }}><Save className="h-4 w-4" />预览变更</Button>}
      </div>
    </header>

    <div className="space-y-2 border-y border-border py-4 text-sm text-fg-muted">
      <p>保存后，新请求读取新版本；运行中的请求和工具循环保持原策略。当前计数窗口到期后采用新窗口，降低并发不终止在途请求。</p>
      <p>代理超时与发布排空：需部署核验。后端策略值不代表代理已支持相同时长。</p>
      {!writable && <p className="text-warning">当前只读，部署预检通过并开放写入后方可修改。</p>}
      {base.warnings.map((warning, index) => <p key={index} className="break-words text-warning">{warning}</p>)}
      {base.errors.map((error, index) => <p key={index} role="alert" className="break-words text-danger">{error.key ? `${error.key}：` : ''}{error.message}</p>)}
    </div>

    {(outdated || reloaded) && <section className="space-y-3 border-l-2 border-warning pl-4" aria-label="版本差异">
      <p className="text-sm text-warning">{outdated ? '策略已有更新。草稿不会被覆盖，重新加载后核对差异。' : `已加载最新版本 ${base.version}，草稿已保留，请重新预览确认。`}</p>
      <Button variant="outline" disabled={saving} loading={query.isFetching} onClick={() => void reload()}><RefreshCw className="h-4 w-4" />重新加载并保留草稿</Button>
      {reloaded && <PolicyChanges fields={base.fields} updates={updates} />}
    </section>}
    {saveError && <p role="alert" className="break-words text-sm text-danger">{saveError}</p>}
    {errors.length > 0 && <ul role="alert" className="space-y-1 text-sm text-danger">{errors.map((error, index) => <li key={index} className="break-words">{error}</li>)}</ul>}

    {GROUPS.map(([group, title]) => <section key={group} aria-labelledby={`${group}-heading`} className="border-b border-border pb-6">
      <h3 id={`${group}-heading`} className="mb-5 text-base font-semibold">{title}</h3>
      <div className="grid gap-x-8 gap-y-6 xl:grid-cols-2">
        {base.fields.filter((field) => field.group === group).map((field) => <div key={field.key} className="min-w-0 space-y-2">
          <label htmlFor={field.key} className="block text-sm font-medium">{field.key === BUDGET_KEY ? '企业每分钟资源预留预算（保守估算）' : field.label}</label>
          <p id={`${field.key}-description`} className="text-xs leading-relaxed text-fg-muted">{field.description}</p>
          {field.key === BUDGET_KEY && <div className="flex items-center justify-between gap-3 py-1"><label htmlFor="budget-enabled" className="text-sm">启用企业每分钟资源预留预算</label><Switch id="budget-enabled" checked={draft.budgetEnabled} disabled={disabled || !field.editable} onCheckedChange={(checked) => setDraft((current) => current && ({ ...current, budgetEnabled: checked, budgetMode: 'override' }))} /></div>}
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1"><Input id={field.key} type="number" inputMode="numeric" step="1" min={field.key === BUDGET_KEY ? 1 : field.min / field.displayScale} max={field.max / field.displayScale} value={draft.values[field.key] ?? ''} disabled={disabled || !field.editable || (field.key === BUDGET_KEY && !draft.budgetEnabled)} placeholder={field.key === BUDGET_KEY ? '填写预算' : '继承环境 / 默认'} aria-describedby={`${field.key}-description ${field.key}-meta`} onChange={(event) => change(field, event.target.value)} /></div>
            <span className="max-w-24 shrink-0 text-xs text-fg-muted">{policyUnitLabel(field.displayUnit)}</span>
            {writable && field.editable && <Button variant="ghost" size="icon" title="恢复环境 / 默认（取消数据库覆盖）" aria-label={`${field.label}：恢复环境 / 默认`} disabled={disabled} onClick={() => clearOverride(field)}><RotateCcw className="h-4 w-4" /></Button>}
          </div>
          <div id={`${field.key}-meta`} className="space-y-1 text-xs text-fg-subtle">
            <p>范围：{field.key === BUDGET_KEY ? 1 : field.min / field.displayScale}–{field.max / field.displayScale} {policyUnitLabel(field.displayUnit)}{field.key === BUDGET_KEY ? '；关闭时保存为 0' : ''}</p>
            <p>当前有效值：{displayPolicyValue(field, field.effectiveValue)} · {policySourceLabel(field.source)} · 版本 {base.version}</p>
            <p>代码默认值：{displayPolicyValue(field, field.defaultValue)}{field.applyMode === 'next-window' ? ' · 下个计数窗口采用新长度' : ' · 新请求生效'}</p>
            {field.key === BUDGET_KEY && <p>保守资源估算，不是实际 Token 额度、人民币余额或日/月配额。失败预留不返还；关闭期间不回算调用。{draft.budgetMode === 'inherit' ? ' 当前草稿继承环境 / 默认，保存后重新计算。' : ''}</p>}
          </div>
        </div>)}
      </div>
    </section>)}

    {showHistory && <PolicyHistory key={base.version} fields={base.fields} writable={writable && !outdated} disabled={saving} onRestore={(item, side) => { setConfirmation({ item, side }); setReason(''); setSaveError(''); }} />}

    <Dialog open={confirmation !== null} onOpenChange={(open) => { if (!open && !saving) setConfirmation(null); }}>
      <DialogContent className="max-h-[85vh] w-[calc(100%-2rem)] max-w-3xl overflow-y-auto">
        <DialogHeader><DialogTitle>{confirmation === 'save' ? '确认模型运行策略变更' : '确认历史恢复'}</DialogTitle><DialogDescription>新请求使用保存后的新版本；运行中请求保持原策略。版本不会倒退。</DialogDescription></DialogHeader>
        {confirmation && confirmation !== 'save' && <div className="space-y-2 text-sm text-warning"><p>恢复版本 {confirmation.item[confirmation.side].version} 的{confirmation.side === 'before' ? '变更前' : '变更后'}数据库覆盖状态，将产生新版本。成功后替换本地草稿。</p><p>环境可能已变，历史有效值不保证复现；取消覆盖将使用当前环境 / 默认。超出当前硬边界的历史配置将被拒绝。</p></div>}
        <PolicyChanges fields={base.fields} updates={previewUpdates} />
        {Object.hasOwn(previewUpdates, 'GATEWAY_MODEL_RATE_WINDOW_MS') && <p className="text-sm text-warning">当前计数窗口到期后采用新窗口。</p>}
        <div><label htmlFor="policy-reason" className="mb-2 block text-sm font-medium">变更原因</label><Textarea id="policy-reason" value={reason} maxLength={500} disabled={saving} onChange={(event) => setReason(event.target.value)} rows={3} /><p className="mt-1 text-xs text-fg-subtle">{reason.trim().length}/500</p></div>
        {saveError && <p role="alert" className="break-words text-sm text-danger">{saveError}</p>}
        <DialogFooter><Button variant="outline" disabled={saving} onClick={() => setConfirmation(null)}>取消</Button><Button loading={saving} loadingText="保存中…" disabled={!reason.trim() || reason.trim().length > 500 || !writable || outdated || (confirmation === 'save' && (!dirty || errors.length > 0))} onClick={() => void confirm()}><Save className="h-4 w-4" />{confirmation === 'save' ? '确认保存' : '确认恢复并创建新版本'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}

function PolicyChanges({ fields, updates }: { fields: ModelRuntimePolicyFieldView[]; updates: Partial<Record<ModelRuntimePolicyKey, string>> }) {
  const changed = fields.filter((field) => Object.hasOwn(updates, field.key));
  if (!changed.length) return <p className="text-sm text-fg-muted">没有数据库覆盖差异。</p>;
  return <div aria-label="变更预览" className="divide-y divide-border text-sm">{changed.map((field) => <div key={field.key} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
    <div className="min-w-0"><p className="font-medium">{field.label}</p><p className="mt-1 text-xs text-fg-muted">影响：{policyImpact(field.key)}</p></div>
    <div className="min-w-0 space-y-1 break-words text-xs"><p>当前：{displayPolicyValue(field, field.effectiveValue)}（{policySourceLabel(field.source)}）</p><p>数据库覆盖：{field.value === '' ? '无' : displayPolicyValue(field, field.value)} → {updates[field.key] === '' ? '取消覆盖' : displayPolicyValue(field, updates[field.key] ?? '')}</p><p className="text-primary">变更后：{updates[field.key] === '' ? '按当前环境 / 默认重新计算，保存后确认有效值' : `${displayPolicyValue(field, updates[field.key] ?? '')}（数据库覆盖）`}</p></div>
  </div>)}</div>;
}

function PolicyHistory({ fields, writable, disabled, onRestore }: { fields: ModelRuntimePolicyFieldView[]; writable: boolean; disabled: boolean; onRestore: (item: ModelRuntimePolicyHistoryItem, side: 'before' | 'after') => void }) {
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [page, setPage] = useState(0);
  const history = useModelRuntimePolicyHistory(cursors[page]);
  return <section aria-labelledby="policy-history-heading" className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 id="policy-history-heading" className="text-base font-semibold">变更历史</h3><div className="flex items-center gap-2"><Button variant="outline" size="icon" aria-label="历史上一页" title="上一页" disabled={page === 0 || history.isFetching} onClick={() => setPage(page - 1)}><ArrowLeft className="h-4 w-4" /></Button><span className="text-sm text-fg-muted">第 {page + 1} 页</span><Button variant="outline" size="icon" aria-label="历史下一页" title="下一页" disabled={!history.data?.nextCursor || history.isFetching} onClick={() => { setCursors([...cursors.slice(0, page + 1), history.data?.nextCursor ?? undefined]); setPage(page + 1); }}><ArrowRight className="h-4 w-4" /></Button></div></div>
    {history.isLoading && <CenteredSpinner label="加载策略历史…" />}
    {history.error && <div role="alert" className="space-y-2 text-sm text-danger"><p>历史加载失败：{history.error.message}</p><Button variant="outline" onClick={() => void history.refetch()} loading={history.isFetching}><RefreshCw className="h-4 w-4" />重试</Button></div>}
    {history.data && !Array.isArray(history.data.items) && <p role="alert" className="text-sm text-danger">历史响应格式异常，请重新加载。</p>}
    {history.data?.items?.length === 0 && <p className="text-sm text-fg-muted">暂无策略变更记录。</p>}
    {history.data?.items?.map((item) => <article key={item.id} className="space-y-3 border-b border-border py-4">
      <div className="flex flex-col justify-between gap-3 sm:flex-row"><div className="min-w-0 space-y-1"><p className="text-sm font-medium">版本 {item.before.version} → {item.after.version}</p><p className="break-words text-xs text-fg-muted">{new Date(item.createdAt).toLocaleString('zh-CN')} · 操作人 {item.actorId}</p><p className="break-words text-sm">原因：{item.reason}</p>{item.restoredFrom && <p className="break-words text-xs text-fg-muted">历史恢复：{item.restoredFrom.historyId} · {item.restoredFrom.side === 'before' ? '变更前' : '变更后'}</p>}</div>
        {writable && <div className="flex shrink-0 flex-wrap gap-2"><Button variant="outline" size="sm" disabled={disabled} onClick={() => onRestore(item, 'before')}><RotateCcw className="h-3.5 w-3.5" />恢复变更前</Button><Button variant="outline" size="sm" disabled={disabled} onClick={() => onRestore(item, 'after')}><RotateCcw className="h-3.5 w-3.5" />恢复变更后</Button></div>}
      </div>
      <div className="space-y-1 break-words text-xs text-fg-muted">{fields.filter((field) => item.before.overrides[field.key] !== item.after.overrides[field.key] || item.before.effectivePolicy[field.key] !== item.after.effectivePolicy[field.key]).map((field) => <p key={field.key}>{field.label}：{displayPolicyValue(field, item.before.effectivePolicy[field.key])}（{policySourceLabel(item.before.sources[field.key])}） → {displayPolicyValue(field, item.after.effectivePolicy[field.key])}（{policySourceLabel(item.after.sources[field.key])}）</p>)}</div>
    </article>)}
  </section>;
}
