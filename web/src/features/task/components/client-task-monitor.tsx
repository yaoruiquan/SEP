'use client';

import { useState } from 'react';
import { Activity, ChevronDown, ChevronLeft, ChevronRight, Monitor } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CenteredSpinner } from '@/components/ui/feedback';
import {
  useClientTaskMirror,
  useClientTaskMirrors,
  type ClientTaskMirror,
  type ClientTaskMirrorEvent,
} from '../use-client-task-mirrors';
import { assembleClientTaskContent } from '../client-task-content';

const labels: Record<string, string> = {
  QUEUED: '排队中', RUNNING: '执行中', WAITING_APPROVAL: '等待审批', PAUSED: '已暂停',
  COMPLETED: '已完成', FAILED: '失败', CANCELLED: '已取消', UNKNOWN: '离线/未知',
};

const variant = (s: string) =>
  s === 'COMPLETED' ? 'glass-success' : s === 'FAILED' || s === 'CANCELLED' ? 'glass-danger' : s === 'UNKNOWN' ? 'glass-warning' : 'glass-info';

function formatTime(value: string | undefined) {
  if (!value) return '时间未知';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '时间未知' : date.toLocaleString('zh-CN', { hour12: false });
}

function ContentBlock({ type, events }: { type: 'user_input' | 'model_output'; events: ClientTaskMirrorEvent[] }) {
  const contents = assembleClientTaskContent(events).filter((item) => item.type === type);
  if (!contents.length) return null;
  return (
    <div className="mt-3 space-y-2">
      <h4 className="font-medium text-gtext-secondary">{type === 'user_input' ? '用户输入' : '模型输出'}</h4>
      {contents.map((content) => (
        <div key={content.id} className="rounded border border-glassline bg-gbg-deep/40 p-2">
          {content.clientRunId && <p className="mb-1 break-all text-[11px] text-gtext-muted">运行：{content.clientRunId}</p>}
          <pre className="whitespace-pre-wrap break-words font-sans text-gtext-primary">{content.text || '（空内容）'}</pre>
          {(content.total > 1 || content.incomplete) && (
            <p className={content.incomplete ? 'mt-1 text-gdanger' : 'mt-1 text-gtext-muted'}>
              {content.incomplete ? `正文不完整：已收到 ${content.received}/${content.total} 个片段` : `已组装 ${content.total} 个片段`}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function Row({ task, open, toggle }: { task: ClientTaskMirror; open: boolean; toggle: () => void }) {
  const detail = useClientTaskMirror(task.id, open);
  const [now] = useState(() => Date.now());
  const stale = task.lastHeartbeatAt && !['COMPLETED', 'FAILED', 'CANCELLED'].includes(task.status) && now - new Date(task.lastHeartbeatAt).getTime() > 60000;
  const events = detail.data?.events ?? [];

  return (
    <>
      <button type="button" onClick={toggle} aria-expanded={open} className="grid w-full grid-cols-[minmax(0,1fr)_100px_48px] sm:grid-cols-[minmax(0,1fr)_120px_70px_minmax(0,1fr)_70px] gap-3 border-b border-glassline px-4 py-3 text-left hover:bg-gbg-deep/40">
        <span className="min-w-0">
          <span className="block truncate text-sm text-gtext-primary">{task.title}</span>
          <span className="text-[11px] text-gtext-muted">{task.user?.name ?? '创建人未知'} · {task.taskType} · {task.clientVersion ?? '版本未知'}</span>
          {stale && <span className="ml-2 text-[11px] text-gtext-muted" title="最近 60 秒未收到心跳，不代表任务状态改变">心跳延迟</span>}
        </span>
        <Badge variant={variant(task.status)}>{labels[task.status] ?? '离线/未知'}</Badge>
        <span className="text-xs text-gtext-secondary">{Math.round(task.progress ?? 0)}%</span>
        <span className="hidden truncate text-xs text-gtext-muted sm:block">{task.activity ?? task.currentStep ?? '暂无活动'}</span>
        <span className="hidden items-center gap-1 text-xs text-gtext-muted sm:flex">{open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}详情</span>
      </button>
      {open && (
        <div className="border-b border-glassline bg-gbg-deep/25 px-10 py-3 text-xs text-gtext-muted">
          <p>更新时间：{formatTime(task.updatedAt)}</p>
          {detail.isLoading ? '正在读取事件…' : detail.isError ? '事件读取失败，请稍后重试。' : (
            <>
              <ContentBlock type="user_input" events={events} />
              <ContentBlock type="model_output" events={events} />
              <div className="mt-3 space-y-1 border-t border-glassline pt-2">
                <h4 className="font-medium text-gtext-secondary">任务事件</h4>
                {events.length ? events.map((event) => <div key={event.id} className="flex gap-3 py-1"><span>#{event.sequence}</span><span>{event.type}</span><span className="truncate">{['user_input', 'model_output'].includes(event.type) ? '正文见上方' : event.message ?? event.stepKey ?? '状态更新'}</span></div>) : '暂无事件记录'}
              </div>
            </>
          )}
          {task.errorSummary && <p className="mt-2 text-gdanger">{task.errorSummary}</p>}
        </div>
      )}
    </>
  );
}


export function ClientTaskMonitor() {
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string>();
  const limit = 50;
  const q = useClientTaskMirrors(true, { page, limit });
  const result = q.data;
  const changePage = (next: number) => { setSelected(undefined); setPage(next); };

  if (q.isLoading) return <CenteredSpinner label="正在读取客户端任务…" />;
  if (q.isError) return (
    <div className="space-y-3 p-8 text-sm text-gdanger" role="alert">
      <p>客户端任务监控暂时不可用，请稍后重试。</p>
      <Button variant="glass" size="sm" onClick={() => void q.refetch()}>重试</Button>
      {page > 1 && <Button variant="glass" size="sm" onClick={() => changePage(page - 1)}>返回上一页</Button>}
    </div>
  );

  return (
    <section className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
      <div className="mx-auto max-w-6xl overflow-hidden rounded-glass-md border border-glassline bg-gbg-deep/30">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-glassline px-4 py-3">
          <div><h2 className="flex items-center gap-2 text-sm font-semibold text-gtext-primary"><Monitor className="h-4 w-4 text-gbrand-text" />客户端任务监控</h2><p className="mt-1 text-[11px] text-gtext-muted">仅显示已同步到云端的记录 · 共 {result?.total ?? 0} 条</p></div>
          <span className="flex items-center gap-1 text-xs text-gtext-muted"><Activity className="h-3.5 w-3.5" />每 15 秒刷新</span>
        </div>
        {result?.legacy && <p className="px-4 py-2 text-xs text-gtext-muted">服务端尚未支持完整分页，目前仅显示最近最多 100 条记录。</p>}
        {result?.items.length ? result.items.map((task) => <Row key={task.id} task={task} open={selected === task.id} toggle={() => setSelected((id) => (id === task.id ? undefined : task.id))} />) : <div className="p-10 text-center text-sm text-gtext-muted">暂无已同步的客户端任务</div>}
        {result && (result.total > limit || page > 1) && (
          <div className="flex items-center justify-between border-t border-glassline px-4 py-3 text-xs text-gtext-muted">
            <span>第 {page} 页 · 每页 {limit} 条</span>
            <div className="flex gap-2"><button type="button" disabled={page <= 1} onClick={() => changePage(page - 1)} className="rounded border border-glassline p-1 disabled:opacity-40" aria-label="上一页"><ChevronLeft className="h-4 w-4" /></button><button type="button" disabled={!result.hasNextPage} onClick={() => changePage(page + 1)} className="rounded border border-glassline p-1 disabled:opacity-40" aria-label="下一页"><ChevronRight className="h-4 w-4" /></button></div>
          </div>
        )}
      </div>
    </section>
  );
}
