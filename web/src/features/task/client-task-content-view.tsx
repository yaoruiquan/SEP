'use client';

import type { ClientTaskMirrorEvent } from './use-client-task-mirrors';
import {
  assembleClientTaskContent, clientTaskContentLabel, clientTaskMetadataLabel,
  clientTaskReplyEmptyState, clientTaskStateEvidence,
} from './client-task-content';

export function clientContentTime(value: string | null | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return '时间未知';
  return new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}

export function ClientTaskEvidence({ events, status, clientRunId, participationId }: {
  events: ClientTaskMirrorEvent[]; status: string; clientRunId?: string; participationId?: string | null;
}) {
  const evidence = clientTaskStateEvidence(events, status, { clientRunId, participationId });
  return <p className="my-2 text-xs text-gtext-muted">
    {evidence ? `状态来源：${evidence.source === 'live' ? '实时上报' : evidence.source === 'local-run' ? '本地运行记录' : '历史快照'} · 核查时间：${clientContentTime(evidence.observedAt)}` : '最后上报状态，来源未核实'}
    {evidence?.progress !== undefined && ` · 明确上报进度 ${evidence.progress}%`}
    {evidence?.runEndedAt && ['PAUSED', 'INTERRUPTED'].includes(status) && ` · 停止时间：${clientContentTime(evidence.runEndedAt)}`}
  </p>;
}

export function ClientTaskContentView({ events, status, showEvents = true }: {
  events: ClientTaskMirrorEvent[]; status?: string; showEvents?: boolean;
}) {
  const contents = assembleClientTaskContent(events);
  return <div className="min-w-0">
    {contents.map((content) => <section key={content.id} aria-label={content.type === 'user_input' ? '用户输入' : '员工回复'} className="border-l-2 border-glassline py-3 pl-3">
      <h4 className="text-sm font-medium text-gtext-secondary">{content.type === 'user_input' ? '用户输入' : '员工回复'}</h4>
      <p className="mt-1 text-[11px] text-gtext-muted">{content.occurredAt ? `发生于 ${clientContentTime(content.occurredAt)}` : `接收于 ${clientContentTime(content.receivedAt)}`}{content.timeApproximate ? '（近似时间）' : ''}
        {content.incomplete && ` · 正文不完整（${content.received}/${content.total} 片）`}
      </p>
      <pre className="mt-2 max-h-[32rem] overflow-auto whitespace-pre-wrap break-words font-sans text-sm leading-6 text-gtext-primary">{content.text || '（空内容）'}</pre>
      {content.type === 'model_output' && <p className={`mt-1 text-xs ${content.completeness === 'partial' ? 'text-gwarning' : 'text-gtext-muted'}`}>{clientTaskContentLabel(content, status)}</p>}
      <details className="mt-1 text-[11px] text-gtext-muted"><summary className="cursor-pointer">正文时间</summary>发生时间（UTC+8）：{clientContentTime(content.occurredAt)} · 接收时间（UTC+8）：{clientContentTime(content.receivedAt)}
        {content.timeApproximate && <p>正文时间近似：片时间缺失或不一致</p>}
      </details>
    </section>)}
    {!contents.some((content) => content.type === 'model_output') && <section aria-label="员工回复" className="border-l-2 border-glassline py-3 pl-3"><h4 className="text-sm font-medium text-gtext-secondary">员工回复</h4><p className="mt-2 text-sm text-gtext-muted">{clientTaskReplyEmptyState(events)}</p></section>}
    {showEvents && <details className="mt-3 border-t border-glassline pt-2 text-xs text-gtext-muted">
      <summary className="cursor-pointer">任务事件 · {events.length}</summary>
      <div className="mt-2 max-h-72 overflow-auto">{events.length ? [...events].sort((a, b) => a.sequence - b.sequence).map((event) => <div key={event.id} className="grid grid-cols-[3rem_minmax(0,1fr)] gap-2 border-b border-glassline/40 py-2"><span>#{event.sequence}</span><div className="min-w-0 break-words"><span>{event.type} · {clientContentTime(event.occurredAt)}</span><p>{clientTaskMetadataLabel(event) ?? (['user_input', 'model_output'].includes(event.type) ? '正文见上方' : event.message ?? event.stepKey ?? '状态更新')}</p></div></div>) : <p>暂无事件记录</p>}</div>
    </details>}
  </div>;
}
