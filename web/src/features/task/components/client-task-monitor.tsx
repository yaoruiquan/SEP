'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronLeft, ChevronRight, Filter, Monitor, RefreshCw, RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CenteredSpinner } from '@/components/ui/feedback';
import { EmployeeUsageBody } from '@/features/employee/employee-usage-records';
import { useEmployeeUsageDetail } from '@/features/employee/use-employee-usage';
import {
  useClientTaskMirror,
  useClientTaskMirrors,
  useClientTaskMirrorFilterOptions,
  type ClientTaskMirror,
  type ClientTaskMirrorDetail,
  type ClientTaskMirrorEvent,
  type ClientTaskMirrorListOptions,
  type ClientTaskMirrorSort,
  type ClientTaskSubscriptionOption,
} from '../use-client-task-mirrors';
import { assembleClientTaskContent } from '../client-task-content';

const labels: Record<string, string> = {
  QUEUED: '排队中', RUNNING: '执行中', WAITING_APPROVAL: '等待审批', PAUSED: '已暂停',
  COMPLETED: '已完成', FAILED: '失败', CANCELLED: '已取消', UNKNOWN: '离线/未知',
};
const views = { active: '进行中', attention: '待处理', history: '全部历史' } as const;
const sorts: Record<ClientTaskMirrorSort, string> = {
  queuedAt_desc: '排队时间 · 最新', queuedAt_asc: '排队时间 · 最早',
  startedAt_desc: '开始时间 · 最新', startedAt_asc: '开始时间 · 最早',
  updatedAt_desc: '更新时间 · 最新', updatedAt_asc: '更新时间 · 最早',
};
const controlClass = 'h-9 w-full min-w-0 rounded border border-glassline bg-gbg-deep px-2 text-xs text-gtext-primary';
const variant = (status: string) => status === 'COMPLETED' ? 'glass-success'
  : status === 'FAILED' || status === 'CANCELLED' ? 'glass-danger' : status === 'UNKNOWN' ? 'glass-warning' : 'glass-info';

function formatTime(value: string | null | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return '时间未知';
  return new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}

function employeeName(value: ClientTaskSubscriptionOption) {
  return value.subscriptionName || value.employeeName || '员工名称未知';
}

function EmployeeLink({ employee }: { employee: ClientTaskSubscriptionOption }) {
  return employee.subscriptionId
    ? <Link className="break-words text-gbrand-text hover:underline" href={`/my-employees/${encodeURIComponent(employee.subscriptionId)}`}>{employeeName(employee)}</Link>
    : <span>员工归属未知</span>;
}

function EventContent({ events }: { events: ClientTaskMirrorEvent[] }) {
  const contents = assembleClientTaskContent(events);
  return <div className="min-w-0">
    {contents.map((content) => <div key={content.id} className="border-l-2 border-glassline py-3 pl-3">
      <h4 className="font-medium text-gtext-secondary">{content.type === 'user_input' ? '用户输入' : '模型输出'}</h4>
      <p className="mt-1 text-[11px] text-gtext-muted">发生时间（UTC+8）：{formatTime(content.occurredAt)} · 接收时间（UTC+8）：{formatTime(content.receivedAt)}</p>
      {content.timeApproximate && <p className="mt-1 text-[11px] text-gwarning">正文时间近似：片时间缺失、不一致或正文不完整</p>}
      <pre className="mt-2 max-h-[32rem] overflow-auto whitespace-pre-wrap break-words font-sans text-xs leading-6 text-gtext-primary">{content.text || '（空内容）'}</pre>
      {(content.total > 1 || content.incomplete) && <p className={content.incomplete ? 'mt-1 text-gdanger' : 'mt-1 text-gtext-muted'}>
        {content.incomplete ? `正文不完整：已收到 ${content.received}/${content.total} 个片段` : `已组装 ${content.total} 个片段`}
      </p>}
    </div>)}
    <details className="mt-3 border-t border-glassline pt-2">
      <summary className="cursor-pointer text-gtext-secondary">任务事件 · {events.length}</summary>
      <div className="mt-2 max-h-72 overflow-auto">
        {events.length ? [...events].sort((a, b) => a.sequence - b.sequence).map((event) => <div key={event.id} className="grid grid-cols-[3rem_minmax(0,1fr)] gap-2 border-b border-glassline/40 py-2">
          <span>#{event.sequence}</span><div className="min-w-0 break-words"><span>{event.type} · {formatTime(event.occurredAt)}</span>
            <p>{['user_input', 'model_output'].includes(event.type) ? '正文见上方' : event.message ?? event.stepKey ?? '状态更新'}</p>
          </div>
        </div>) : <p>暂无事件记录</p>}
      </div>
    </details>
  </div>;
}

/** Full authorized task detail; employee-scoped usage must use its scoped endpoint instead. */
export function ClientTaskMirrorDetailView({ detail }: { detail: ClientTaskMirrorDetail }) {
  const runs = detail.runs ?? [];
  // Nested events prove their parent relation. Preserve contradictory metadata as unresolved.
  const allEvents = new Map((detail.events ?? []).map((event) => [event.id, event]));
  for (const run of runs) for (const participation of run.participations) {
    for (const event of participation.events ?? []) {
      allEvents.set(event.id, { ...event, clientRunId: event.clientRunId ?? run.clientRunId, participationId: event.participationId ?? participation.id });
    }
  }
  const events = [...allEvents.values()];
  const proven = events.filter((event) => runs.some((run) => run.clientRunId === event.clientRunId
    && (!event.participationId || run.participations.some((participant) => participant.id === event.participationId))));
  const provenIds = new Set(proven.map((event) => event.id));
  const unresolved = events.filter((event) => !provenIds.has(event.id));

  return <div className="min-w-0 space-y-4 text-xs text-gtext-muted">
    <p>更新时间（UTC+8）：{formatTime(detail.updatedAt)}</p>
    {(!runs.length || runs.some((run) => run.protocolVersion < 2) || unresolved.length > 0) && <p className="border-l-2 border-gwarning pl-3">历史记录归属覆盖有限；未确认事件不会归到当前员工或节点。</p>}
    {runs.map((run, index) => <section key={run.id} aria-label={`运行批次 ${run.clientRunId}`} className="min-w-0 border-t border-glassline pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="break-all font-medium text-gtext-primary">运行批次 {index + 1} · {run.clientRunId}</h3>
        <Badge variant={variant(run.status)}>{labels[run.status] ?? run.status}</Badge>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1"><EmployeeLink employee={run} /><span>排队：{formatTime(run.queuedAt)}</span><span>开始：{formatTime(run.startedAt)}</span><span>结束：{formatTime(run.completedAt)}</span></div>
      <EventContent events={proven.filter((event) => event.clientRunId === run.clientRunId && !event.participationId)} />
      {run.participations.map((participant) => <section key={participant.id} aria-label={`参与执行 ${participant.executionId}`} className="mt-4 min-w-0 border-t border-glassline pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="break-words font-medium text-gtext-secondary">{participant.title || '参与执行'}{participant.nodeId ? ` · 节点 ${participant.nodeId}` : ''}</h4>
          <Badge variant={variant(participant.status)}>{labels[participant.status] ?? participant.status}</Badge>
        </div>
        <p className="mt-2 break-all">执行：{participant.executionId} · <EmployeeLink employee={participant} /> · 模型：{participant.modelId ?? '未知'}</p>
        <p className="mt-1">开始：{formatTime(participant.startedAt)} · 结束：{formatTime(participant.completedAt)}</p>
        <EventContent events={proven.filter((event) => event.clientRunId === run.clientRunId && event.participationId === participant.id)} />
      </section>)}
    </section>)}
    {unresolved.length > 0 && <section aria-label="历史归属未确认" className="border-t border-glassline pt-4"><h3 className="text-gtext-secondary">历史归属未确认</h3><EventContent events={unresolved} /></section>}
    {!events.length && !runs.length && <p>暂无事件记录</p>}
    {detail.errorSummary && <p className="break-words text-gdanger">{detail.errorSummary}</p>}
  </div>;
}

function ScopedTaskDetail({ id, subscriptionId }: { id: string; subscriptionId: string }) {
  const query = useEmployeeUsageDetail(subscriptionId, { source: 'client', recordId: id }, 10000);
  if (query.isLoading) return <CenteredSpinner label="正在读取事件…" />;
  if (query.isError) return <div role="alert" className="space-y-2 py-3 text-sm text-gdanger">
    <p>事件读取失败，请稍后重试。记录可能不存在或没有访问权限。</p>
    <Button variant="glass" size="sm" onClick={() => void query.refetch()}><RefreshCw className="h-3.5 w-3.5" />重试详情</Button>
  </div>;
  return query.data?.source === 'client' ? <><h3 className="mb-3 break-words text-sm text-gtext-primary">{query.data.task.title}</h3><EmployeeUsageBody subscriptionId={subscriptionId} detail={query.data} showMonitorLink={false} /></> : null;
}

function FullTaskDetail({ id }: { id: string }) {
  const query = useClientTaskMirror(id);
  if (query.isLoading) return <CenteredSpinner label="正在读取事件…" />;
  if (query.isError) return <div role="alert" className="space-y-2 py-3 text-sm text-gdanger">
    <p>事件读取失败，请稍后重试。记录可能不存在或没有访问权限。</p>
    <Button variant="glass" size="sm" onClick={() => void query.refetch()}><RefreshCw className="h-3.5 w-3.5" />重试详情</Button>
  </div>;
  return query.data ? <><h3 className="mb-3 break-words text-sm text-gtext-primary">{query.data.title}</h3><ClientTaskMirrorDetailView detail={query.data} /></> : null;
}

function TaskDetail({ id, subscriptionId }: { id: string; subscriptionId?: string }) {
  return subscriptionId ? <ScopedTaskDetail key={subscriptionId} id={id} subscriptionId={subscriptionId} /> : <FullTaskDetail id={id} />;
}

function Row({ task, open, toggle, now, subscriptionId }: { task: ClientTaskMirror; open: boolean; toggle: () => void; now: number; subscriptionId?: string }) {
  const heartbeat = task.lastHeartbeatAt ? Date.parse(task.lastHeartbeatAt) : NaN;
  const heartbeatAge = Math.max(0, Math.floor((now - heartbeat) / 1000));
  const stale = Number.isFinite(heartbeat) && !['COMPLETED', 'FAILED', 'CANCELLED'].includes(task.status) && now - heartbeat > 60000;
  const subscriptions = task.subscriptionSummary?.subscriptions ?? [];
  return <>
    <button type="button" onClick={toggle} aria-expanded={open} className="grid w-full grid-cols-[minmax(0,1fr)_5.5rem_1rem] items-center gap-3 border-b border-glassline py-3 text-left hover:bg-gbg-deep/40 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_5.5rem_3rem_1rem]">
      <span className="min-w-0"><span className="block break-words text-sm text-gtext-primary">{task.title}</span>
        <span className="mt-1 block break-words text-[11px] text-gtext-muted">{task.user?.name ?? '创建人未知'} · {task.taskType} · {task.clientVersion ?? '版本未知'}</span>
        <span className="mt-1 block break-words text-xs text-gtext-secondary">当前活动：{task.activity || task.currentStep || '未同步'}</span>
        {task.activity && task.currentStep && task.activity !== task.currentStep && <span className="mt-1 block break-words text-[11px] text-gtext-muted">当前步骤：{task.currentStep}</span>}
        <span className="mt-1 flex min-w-0 flex-wrap gap-x-3 gap-y-1 break-words text-[11px] text-gtext-muted">
          <span>排队（UTC+8）：{formatTime(task.queuedAt)}</span>
          <span>开始（UTC+8）：{formatTime(task.startedAt)}</span>
          <span>最近同步（UTC+8）：{formatTime(task.updatedAt)}</span>
        </span>
        {stale && <span className="mt-1 block text-[11px] text-gtext-muted" title="最近 60 秒未收到心跳，不代表任务状态改变">心跳延迟 · {heartbeatAge} 秒未收到</span>}
        <span className="mt-1 block break-words text-[11px] text-gtext-muted sm:hidden">{subscriptions.length ? subscriptions.map(employeeName).join('、') : '员工归属未确认'}</span>
      </span>
      <span className="hidden min-w-0 text-xs text-gtext-secondary sm:block">{subscriptions.length ? subscriptions.map((employee) => <span key={employee.subscriptionId} className="block break-words">{employeeName(employee)} · {employee.executionCount} 次执行</span>) : '员工归属未确认'}
        {task.subscriptionSummary?.coverage === 'limited' && <span className="mt-1 block text-[11px] text-gtext-muted">历史归属覆盖有限</span>}
      </span>
      <Badge variant={variant(task.status)}>{labels[task.status] ?? task.status}</Badge>
      <span className="hidden text-xs tabular-nums text-gtext-secondary sm:block">{Math.round(task.progress ?? 0)}%</span>
      {open ? <ChevronDown className="h-4 w-4 text-gtext-muted" /> : <ChevronRight className="h-4 w-4 text-gtext-muted" />}
    </button>
    {open && <div className="min-w-0 border-b border-glassline bg-gbg-deep/25 px-3 py-4 sm:px-6"><TaskDetail id={task.id} subscriptionId={subscriptionId} /></div>}
  </>;
}

type Draft = { q: string; subscriptionId: string; userId: string; taskType: string; from: string; to: string; statuses: string[]; sort: ClientTaskMirrorSort };
const emptyDraft: Draft = { q: '', subscriptionId: '', userId: '', taskType: '', from: '', to: '', statuses: [], sort: 'queuedAt_desc' };

function dateFilter(value: string) {
  if (!value) return undefined;
  const date = new Date(`${value}+08:00`);
  if (!Number.isFinite(date.getTime())) throw new Error('请输入有效的 UTC+8 时间');
  return date.toISOString();
}

export function ClientTaskMonitor({ taskId, subscriptionId }: { taskId?: string; subscriptionId?: string } = {}) {
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string>();
  const [dismissedTaskId, setDismissedTaskId] = useState<string>();
  const [view, setView] = useState<NonNullable<ClientTaskMirrorListOptions['view']>>('active');
  const [draft, setDraft] = useState<Draft>({ ...emptyDraft, subscriptionId: subscriptionId ?? '' });
  const [filters, setFilters] = useState<ClientTaskMirrorListOptions>({ sort: 'queuedAt_desc', ...(subscriptionId ? { subscriptionId } : {}) });
  const [filterError, setFilterError] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [previousSubscriptionId, setPreviousSubscriptionId] = useState(subscriptionId);
  const [previousTaskId, setPreviousTaskId] = useState(taskId);
  // Reconcile navigation before rendering children so details never fetch the previous scope.
  if (previousSubscriptionId !== subscriptionId) {
    setPreviousSubscriptionId(subscriptionId);
    setDraft((previous) => ({ ...previous, subscriptionId: subscriptionId ?? '' }));
    setFilters((previous) => ({ ...previous, subscriptionId: subscriptionId || undefined }));
    setPage(1);
    setSelected(undefined);
  }
  if (previousTaskId !== taskId || previousSubscriptionId !== subscriptionId) {
    setPreviousTaskId(taskId);
    setDismissedTaskId(undefined);
  }
  const limit = 50;
  const query = useClientTaskMirrors(true, { page, limit, view, ...filters });
  const options = useClientTaskMirrorFilterOptions(filters);
  const result = query.data;
  const linkedTaskId = taskId && dismissedTaskId !== taskId ? taskId : undefined;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 10000);
    return () => window.clearInterval(timer);
  }, []);
  const updateDraft = (key: keyof Omit<Draft, 'statuses'>, value: string) => setDraft((previous) => ({ ...previous, [key]: value }));
  const changePage = (next: number) => { setSelected(undefined); setPage(next); };
  const applyFilters = (event: FormEvent) => {
    event.preventDefault();
    try {
      const from = dateFilter(draft.from);
      const to = dateFilter(draft.to);
      if (from && to && Date.parse(to) <= Date.parse(from)) throw new Error('结束时间必须晚于开始时间');
      setFilters({ q: draft.q.trim() || undefined, subscriptionId: draft.subscriptionId || undefined, userId: draft.userId || undefined,
        taskType: draft.taskType || undefined, from, to, statuses: draft.statuses.length ? draft.statuses.join(',') : undefined, sort: draft.sort });
      setFilterError('');
      changePage(1);
    } catch (error) { setFilterError(error instanceof Error ? error.message : '筛选条件无效'); }
  };

  return <section className="min-h-0 min-w-0 flex-1 overflow-auto p-4 sm:p-6">
    <div className="mx-auto max-w-6xl">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-glassline pb-3">
        <div><h2 className="flex items-center gap-2 text-sm font-semibold text-gtext-primary"><Monitor className="h-4 w-4 text-gbrand-text" />客户端任务监控</h2>
          <p className="mt-1 text-[11px] text-gtext-muted">仅显示已同步到云端的记录 · 共 {result?.total ?? '—'} 条</p>
        </div>
        <Button variant="glass" size="sm" title="刷新客户端任务" aria-label="刷新客户端任务" onClick={() => { void query.refetch(); void options.refetch(); }}><RefreshCw className="h-4 w-4" /></Button>
      </header>
      <div role="tablist" aria-label="客户端任务分类" className="flex flex-wrap gap-4 border-b border-glassline">
        {(Object.keys(views) as (keyof typeof views)[]).map((key) => <button key={key} type="button" role="tab" aria-selected={key === view} onClick={() => { setView(key); changePage(1); }} className={`border-b-2 py-3 text-xs ${key === view ? 'border-gbrand-text text-gbrand-text' : 'border-transparent text-gtext-muted'}`}>
          {views[key]}{options.data ? ` · ${options.data.counts[key]}` : ''}
        </button>)}
      </div>
      <form onSubmit={applyFilters} className="space-y-3 border-b border-glassline py-3">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <label className="min-w-0 text-[11px] text-gtext-muted">搜索<input aria-label="搜索任务" type="search" className={controlClass} placeholder="任务标题 / 关键词" value={draft.q} onChange={(event) => updateDraft('q', event.target.value)} /></label>
          <label className="min-w-0 text-[11px] text-gtext-muted">员工<select aria-label="员工筛选" className={controlClass} value={draft.subscriptionId} onChange={(event) => updateDraft('subscriptionId', event.target.value)}>
            <option value="">全部员工</option>{draft.subscriptionId && !options.data?.subscriptions.some((item) => item.subscriptionId === draft.subscriptionId) && <option value={draft.subscriptionId}>{draft.subscriptionId}</option>}
            {options.data?.subscriptions.map((item) => <option key={item.subscriptionId} value={item.subscriptionId}>{employeeName(item)}</option>)}
          </select></label>
          <label className="min-w-0 text-[11px] text-gtext-muted">成员<select aria-label="成员筛选" className={controlClass} value={draft.userId} onChange={(event) => updateDraft('userId', event.target.value)}>
            <option value="">全部成员</option>{draft.userId && !options.data?.users.some((item) => item.id === draft.userId) && <option value={draft.userId}>{draft.userId}</option>}
            {options.data?.users.map((item) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}
          </select></label>
          <label className="min-w-0 text-[11px] text-gtext-muted">任务类型<select aria-label="任务类型筛选" className={controlClass} value={draft.taskType} onChange={(event) => updateDraft('taskType', event.target.value)}>
            <option value="">全部类型</option>{draft.taskType && !options.data?.taskTypes.includes(draft.taskType) && <option value={draft.taskType}>{draft.taskType}</option>}
            {options.data?.taskTypes.map((item) => <option key={item} value={item}>{item}</option>)}
          </select></label>
          <label className="min-w-0 text-[11px] text-gtext-muted">排序<select aria-label="任务排序" className={controlClass} value={draft.sort} onChange={(event) => updateDraft('sort', event.target.value)}>
            {(Object.keys(sorts) as ClientTaskMirrorSort[]).map((key) => <option key={key} value={key}>{sorts[key]}</option>)}
          </select></label>
        </div>
        <details><summary className="cursor-pointer text-xs text-gtext-secondary">时间与状态</summary><div className="mt-2 grid gap-3 sm:grid-cols-2">
          <label className="min-w-0 text-[11px] text-gtext-muted">开始时间（UTC+8，含）<input aria-label="开始时间" className={controlClass} type="datetime-local" value={draft.from} onChange={(event) => updateDraft('from', event.target.value)} /></label>
          <label className="min-w-0 text-[11px] text-gtext-muted">结束时间（UTC+8，不含）<input aria-label="结束时间" className={controlClass} type="datetime-local" value={draft.to} onChange={(event) => updateDraft('to', event.target.value)} /></label>
        </div><fieldset className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-gtext-secondary"><legend className="mb-2">任务状态</legend>{Object.entries(labels).map(([status, label]) => <label key={status} className="flex items-center gap-1.5"><input type="checkbox" checked={draft.statuses.includes(status)} onChange={(event) => setDraft((previous) => ({ ...previous, statuses: event.target.checked ? [...previous.statuses, status] : previous.statuses.filter((item) => item !== status) }))} />{label}</label>)}</fieldset></details>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="glass" size="sm"><Filter className="h-3.5 w-3.5" />筛选</Button>
          <Button type="button" variant="ghost" size="sm" title="重置筛选" aria-label="重置筛选" onClick={() => { setDraft(emptyDraft); setFilters({ sort: 'queuedAt_desc' }); setFilterError(''); changePage(1); }}><RotateCcw className="h-3.5 w-3.5" /></Button>
          {filterError && <p role="alert" className="text-xs text-gdanger">{filterError}</p>}
          {options.isError && <div role="alert" className="flex items-center gap-2 text-xs text-gdanger">筛选选项读取失败<Button type="button" variant="ghost" size="sm" onClick={() => void options.refetch()}>重试选项</Button></div>}
        </div>
      </form>
      {linkedTaskId && <section aria-label="指定任务详情" className="border-b border-glassline py-4">
        <div className="mb-3 flex items-center justify-between gap-2"><h2 className="break-all text-sm text-gtext-secondary">指定任务详情 · {linkedTaskId}</h2><Button variant="ghost" size="sm" title="关闭指定任务详情" aria-label="关闭指定任务详情" onClick={() => setDismissedTaskId(linkedTaskId)}><X className="h-4 w-4" /></Button></div>
        <TaskDetail key={linkedTaskId} id={linkedTaskId} subscriptionId={filters.subscriptionId} />
      </section>}
      {result?.legacy && <p className="py-2 text-xs text-gtext-muted">服务端尚未支持完整分页，目前仅显示最近最多 100 条记录；筛选覆盖可能有限。</p>}
      {query.isLoading ? <CenteredSpinner label="正在读取客户端任务…" /> : query.isError ? <div className="space-y-3 py-8 text-sm text-gdanger" role="alert">
        <p>客户端任务监控暂时不可用，请稍后重试。</p><Button variant="glass" size="sm" onClick={() => void query.refetch()}>重试</Button>
        {page > 1 && <Button variant="glass" size="sm" onClick={() => changePage(page - 1)}>返回上一页</Button>}
      </div> : result?.items.length ? result.items.map((task) => <Row key={task.id} task={task} now={now} subscriptionId={filters.subscriptionId} open={selected === task.id && linkedTaskId !== task.id} toggle={() => setSelected((id) => id === task.id ? undefined : task.id)} />) : <div className="py-10 text-center text-sm text-gtext-muted">暂无已同步的客户端任务</div>}
      {result && !query.isError && <div className="flex flex-wrap items-center justify-between gap-2 border-t border-glassline py-3 text-xs text-gtext-muted">
        <span>第 {page} 页 · 每页 {limit} 条</span><div className="flex gap-2"><Button variant="glass" size="sm" disabled={page <= 1} onClick={() => changePage(page - 1)} title="上一页" aria-label="上一页"><ChevronLeft className="h-4 w-4" /></Button><Button variant="glass" size="sm" disabled={!result.hasNextPage} onClick={() => changePage(page + 1)} title="下一页" aria-label="下一页"><ChevronRight className="h-4 w-4" /></Button></div>
      </div>}
    </div>
  </section>;
}
