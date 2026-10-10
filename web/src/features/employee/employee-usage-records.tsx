"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Eye,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CenteredSpinner } from "@/components/ui/feedback";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ClientTaskContentView, ClientTaskEvidence } from "@/features/task/client-task-content-view";
import { CLIENT_TASK_STATUS_LABELS } from "@/features/task/use-client-task-mirrors";
import {
  useEmployeeUsageDetail,
  type EmployeeUsageDetail,
  type EmployeeUsageList,
  type EmployeeUsageRecord,
} from "./use-employee-usage";

const SOURCE_LABELS = {
  client: "客户端任务",
  "client-legacy": "旧客户端记录",
  "web-conversation": "Web 对话",
  "web-task": "Web 任务会话",
};
const TASK_TYPE_LABELS: Record<string, string> = {
  conversation: "对话",
  arrangement: "编排",
  CHAT: "对话",
  TASK: "任务",
};
const STATUS_LABELS: Record<string, string> = {
  ...CLIENT_TASK_STATUS_LABELS,
  QUEUED: "排队中",
  RUNNING: "运行中",
  WAITING_APPROVAL: "待审批",
  PAUSED: "已暂停",
  COMPLETED: "已完成",
  FAILED: "失败",
  CANCELLED: "已取消",
  ACTIVE: "进行中",
  ARCHIVED: "已归档",
};
export function usageTime(value: string | null | undefined) {
  return value
    ? new Date(value).toLocaleString("zh-CN", {
        timeZone: "Asia/Shanghai",
        hour12: false,
      })
    : "时间未知";
}

export function EmployeeUsageRecords({
  subscriptionId,
  data,
  isLoading,
  isError,
  onRetry,
  page,
  onPageChange,
}: {
  subscriptionId: string;
  data?: EmployeeUsageList;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  page: number;
  onPageChange: (page: number) => void;
}) {
  const [selected, setSelected] = useState<EmployeeUsageRecord | null>(null);
  const detail = useEmployeeUsageDetail(subscriptionId, selected);
  return (
    <section className="min-w-0">
      {isError && (
        <div
          role="alert"
          className="mb-4 flex flex-wrap items-center justify-between gap-3 border-l-2 border-gdanger bg-gdanger/5 p-3 text-sm"
        >
          使用记录加载失败{data ? "，当前显示上次读取的数据" : ""}
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw className="h-4 w-4" />
            重新加载
          </Button>
        </div>
      )}
      {isLoading ? (
        <CenteredSpinner label="加载使用记录..." />
      ) : (
        data && (
          <>
            <p className="mb-4 text-xs leading-5 text-gtext-muted">
              已核实记录与旧客户端单员工对话分开标注。旧客户端任务共{" "}
              {data.coverage.legacyClientTaskCount} 项（全部时间），
              {data.coverage.readableLegacyClientTaskCount === undefined
                ? "当前服务版本尚未提供可读取旧记录的数量。"
                : `其中 ${data.coverage.readableLegacyClientTaskCount} 项可在员工页读取，归属未核实。`}
              旧多员工编排等其他历史记录请在{" "}
              <Link className="text-gbrand-text underline" href={`/tasks?${new URLSearchParams({ tab: "monitoring", subscriptionId, scopeSubscriptionId: subscriptionId })}`}>
                客户端监控
              </Link>
              {" "}查看。无账单、混合归属或已删除的 Web 会话不在此列表内。
              模型账单不代表已同步正文，任务级消费未知。历史记录可能早于当前日期范围。
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-gtext-muted">
                    {[
                      "成员",
                      "来源 / 类型",
                      "标题",
                      "状态",
                      "使用 / 接收时间（UTC+8）",
                      "",
                    ].map((label) => (
                      <th key={label} className="px-2 py-3 font-medium">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((record) => (
                    <tr
                      key={`${record.source}:${record.recordId}`}
                      className="border-b border-border/60"
                    >
                      <td className="max-w-36 break-words px-2 py-3">
                        {record.userName || "未命名成员"}
                      </td>
                      <td className="px-2 py-3">
                        <div>{SOURCE_LABELS[record.source]}</div>
                        <div className="text-xs text-gtext-muted">
                          {TASK_TYPE_LABELS[record.taskType] ?? record.taskType}
                          {record.source === "client-legacy" && " · 归属未核实"}
                        </div>
                      </td>
                      <td className="max-w-72 break-words px-2 py-3">
                        {record.title || "未命名记录"}
                      </td>
                      <td className="px-2 py-3">
                        {STATUS_LABELS[record.status] ?? record.status}
                      </td>
                      <td
                        className="whitespace-nowrap px-2 py-3 text-xs tabular-nums"
                        title={record.timeBasis}
                      >
                        {usageTime(record.usedAt)}
                        {record.source === "client-legacy" && (
                          <div className="text-gtext-muted">
                            {record.timeBasis === "legacy-received"
                              ? "接收时间，执行时间未知"
                              : "旧记录时间，来源未核实"}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-3">
                        <Button
                          variant="ghost"
                          size="sm"
                          title="查看使用记录"
                          aria-label={`查看 ${record.title || "未命名记录"}`}
                          onClick={() => setSelected(record)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!data.items.length && (
              <p className="py-10 text-center text-sm text-gtext-muted">
                当前筛选下暂无可展示的使用记录
              </p>
            )}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
              <span className="text-gtext-muted">
                共 {data.total} 项 · 第 {page} 页
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  aria-label="上一页"
                  disabled={page <= 1}
                  onClick={() => onPageChange(page - 1)}
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label="下一页"
                  disabled={page * data.limit >= data.total}
                  onClick={() => onPageChange(page + 1)}
                >
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )
      )}
      <Dialog
        open={Boolean(selected)}
        onOpenChange={(open) => !open && setSelected(null)}
      >
        <DialogContent
          glass
          className="max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-4xl overflow-y-auto"
        >
          <DialogHeader>
            <DialogTitle className="break-words pr-6">
              {selected?.title || "使用记录"}
            </DialogTitle>
            <DialogDescription>
              {selected &&
                `${selected.userName || "未命名成员"} · ${SOURCE_LABELS[selected.source]} · ${selected.timeBasis === "legacy-received" ? "接收于 " : ""}${usageTime(selected.usedAt)}`}
            </DialogDescription>
          </DialogHeader>
          {detail.isLoading ? (
            <CenteredSpinner label="加载正文..." />
          ) : detail.isError ? (
            <div role="alert" className="text-sm">
              无法读取正文，记录可能已失效或没有访问权限。
              <Button
                variant="outline"
                size="sm"
                onClick={() => void detail.refetch()}
              >
                <RefreshCw className="h-4 w-4" />
                重新加载
              </Button>
            </div>
          ) : (
            detail.data && (
              <EmployeeUsageBody
                key={`${detail.data.source}:${detail.data.recordId}`}
                subscriptionId={subscriptionId}
                detail={detail.data}
              />
            )
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

export function EmployeeUsageBody({
  subscriptionId,
  detail,
  showMonitorLink = true,
}: {
  subscriptionId: string;
  detail: EmployeeUsageDetail;
  showMonitorLink?: boolean;
}) {
  const [runId, setRunId] = useState("");
  if (detail.source === "client-legacy") {
    const events = detail.events.filter((event) => (!event.clientRunId || event.clientRunId === detail.run.clientRunId)
      && !event.participationId).map((event) => ({ ...event, clientRunId: detail.run.clientRunId }));
    return (
      <div className="space-y-4">
        <details className="text-xs text-gtext-muted"><summary className="cursor-pointer">旧客户端记录 · 归属未核实</summary><p>
          旧客户端记录 · 归属未核实。按任务原始雇佣关系展示单员工对话，
          仅包含当前运行批次；不代表已核实的参与节点，任务级消费未知。
          旧协议未保存时间来源，开始或入队时间可能由服务器补齐。
        </p></details>
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <span className="text-gtext-muted">
            {STATUS_LABELS[detail.run.status] ?? detail.run.status} ·{" "}
            {detail.run.timeBasis === "legacy-received" ? "接收于 " : "使用于 "}
            {usageTime(detail.run.usedAt)}
            {detail.run.timeBasis === "legacy-received" && "（执行时间未知）"}
            {detail.run.completedAt && ` · 结束于 ${usageTime(detail.run.completedAt)}`}
          </span>
          {showMonitorLink && (
            <Link className="inline-flex items-center gap-1 text-gbrand-text"
              href={`/tasks?${new URLSearchParams({ tab: "monitoring", subscriptionId, scopeSubscriptionId: subscriptionId, taskId: detail.task.id })}`}>
              <ExternalLink className="h-4 w-4" />任务监控
            </Link>
          )}
        </div>
        <ClientTaskEvidence events={events} status={detail.run.status} clientRunId={detail.run.clientRunId} />
        <ClientTaskContentView events={events} status={detail.run.status} />
      </div>
    );
  }
  if (detail.source !== "client")
    return (
      <div className="divide-y divide-border">
        {!detail.messages.length && (
          <p className="py-4 text-sm text-gtext-muted">暂无已保存正文</p>
        )}
        {!detail.messages.some((message) => message.role === "ASSISTANT") && <section aria-label="员工回复" className="py-4"><h4 className="text-sm font-medium">员工回复</h4><p className="mt-2 text-sm text-gtext-muted">暂未收到回复，原因未确认</p></section>}
        {detail.messages.map((message) => (
          <div key={message.id} className="py-4">
            {message.role === "TOOL" ? (
              <details>
                <summary className="cursor-pointer text-sm text-gtext-secondary">
                  工具消息 · {usageTime(message.createdAt)}
                </summary>
                <pre className="mt-3 whitespace-pre-wrap break-words text-sm">
                  {message.content || "无文本内容"}
                </pre>
              </details>
            ) : (
              <>
                <div className="mb-2 text-xs text-gtext-muted">
                  {message.role === "USER"
                    ? "输入"
                    : message.role === "ASSISTANT"
                      ? "输出"
                      : message.role}{" "}
                  · {usageTime(message.createdAt)}
                </div>
                <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-6">
                  {message.content || "无文本内容"}
                </pre>
              </>
            )}
          </div>
        ))}
      </div>
    );
  const run =
    detail.runs.find((item) => item.clientRunId === runId) ??
    detail.runs.at(-1);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="min-w-0 text-sm">
          运行批次{" "}
          <select
            aria-label="运行批次"
            className="ml-2 max-w-full rounded-md border border-border bg-background p-2"
            value={run?.clientRunId ?? ""}
            onChange={(event) => setRunId(event.target.value)}
          >
            {detail.runs.map((item) => (
              <option key={item.clientRunId} value={item.clientRunId}>
                {usageTime(item.queuedAt)}
              </option>
            ))}
          </select>
        </label>
        {showMonitorLink && <Link
          className="inline-flex items-center gap-1 text-sm text-gbrand-text"
          href={`/tasks?${new URLSearchParams({ tab: "monitoring", subscriptionId, scopeSubscriptionId: subscriptionId, taskId: detail.task.id })}`}
        >
          <ExternalLink className="h-4 w-4" />
          任务监控
        </Link>}
      </div>
      <p className="text-xs text-gtext-muted">
        仅当前雇佣关系的实际参与正文，不含任务汇总及其他员工正文。
      </p>
      {(!run || !run.participations.some((participant) => participant.clientRunId === run.clientRunId)) && <ClientTaskContentView events={[]} />}
      {run?.participations.filter((participant) => participant.clientRunId === run.clientRunId).map((participant) => {
        // Nested-only events inherit their proven parent. Contradictory identities cannot
        // supply evidence or body for another run/participation.
        const events = participant.events.filter((event) => (!event.clientRunId || event.clientRunId === run.clientRunId)
          && (!event.participationId || event.participationId === participant.id)).map((event) => ({
            ...event, clientRunId: run.clientRunId, participationId: participant.id,
          }));
        return (
          <section key={participant.id} className="border-t border-border pt-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
              <h3 className="break-words font-medium">
                {participant.title || participant.subscriptionName}
                {participant.nodeId ? ` · 节点 ${participant.nodeId}` : ""}
              </h3>
              <span className="text-gtext-muted">
                {STATUS_LABELS[participant.status] ?? participant.status} ·{" "}
                {usageTime(participant.startedAt)} →{" "}
                {participant.completedAt
                  ? usageTime(participant.completedAt)
                  : "尚未结束"}
              </span>
            </div>
            <ClientTaskEvidence events={events} status={participant.status} clientRunId={run.clientRunId} participationId={participant.id} />
            <ClientTaskContentView events={events} status={participant.status} />
          </section>
        );
      })}
    </div>
  );
}
