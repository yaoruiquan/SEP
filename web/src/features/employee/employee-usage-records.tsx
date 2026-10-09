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
import { assembleClientTaskContent } from "@/features/task/client-task-content";
import {
  useEmployeeUsageDetail,
  type EmployeeUsageDetail,
  type EmployeeUsageList,
  type EmployeeUsageRecord,
} from "./use-employee-usage";

const SOURCE_LABELS = {
  client: "客户端任务",
  "web-conversation": "Web 对话",
  "web-task": "Web 任务会话",
};
const STATUS_LABELS: Record<string, string> = {
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
              仅包含已核实归属的使用记录；旧客户端归属未核实任务{" "}
              {data.coverage.legacyClientTaskCount}{" "}
              项（全部时间）。无账单、混合归属或已删除的 Web
              会话不在此列表内。任务级消费未知。
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
                      "使用时间（UTC+8）",
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
                          {record.taskType}
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
                当前筛选下暂无已核实使用记录
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
                `${selected.userName || "未命名成员"} · ${SOURCE_LABELS[selected.source]} · ${usageTime(selected.usedAt)}`}
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
  if (detail.source !== "client")
    return (
      <div className="divide-y divide-border">
        {!detail.messages.length && (
          <p className="py-4 text-sm text-gtext-muted">暂无已保存正文</p>
        )}
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
          href={`/tasks?${new URLSearchParams({ tab: "monitoring", subscriptionId, taskId: detail.task.id })}`}
        >
          <ExternalLink className="h-4 w-4" />
          任务监控
        </Link>}
      </div>
      <p className="text-xs text-gtext-muted">
        仅当前雇佣关系的实际参与正文，不含任务汇总及其他员工正文。
      </p>
      {run?.participations.map((participant) => {
        const content = assembleClientTaskContent(participant.events);
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
            {!content.length && (
              <p className="text-sm text-gtext-muted">
                该参与记录暂无已同步正文
              </p>
            )}
            {content.map((item) => (
              <div key={item.id} className="border-l-2 border-border py-3 pl-3">
                <p className="mb-2 text-xs text-gtext-muted">
                  {item.type === "user_input" ? "输入" : "输出"} ·{" "}
                  {item.occurredAt
                    ? `发生于 ${usageTime(item.occurredAt)}`
                    : `接收于 ${usageTime(item.receivedAt)}`}
                  {item.timeApproximate ? "（近似时间）" : ""}
                  {item.incomplete
                    ? ` · 正文不完整（${item.received}/${item.total} 片）`
                    : ""}
                </p>
                <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-6">
                  {item.text || "无文本内容"}
                </pre>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}
