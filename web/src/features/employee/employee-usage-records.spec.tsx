import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider } from "@/lib/theme-provider";
import { EmployeeUsageBody, EmployeeUsageRecords } from "./employee-usage-records";
import type {
  EmployeeUsageDetail,
  EmployeeUsageList,
  EmployeeUsageRecord,
} from "./use-employee-usage";
import type { ClientTaskMirrorEvent } from "@/features/task/use-client-task-mirrors";

const mocks = vi.hoisted(() => ({
  detail: vi.fn(),
  response: undefined as EmployeeUsageDetail | undefined,
}));
vi.mock("./use-employee-usage", () => ({
  useEmployeeUsageDetail: (id: string, record: EmployeeUsageRecord | null) => {
    mocks.detail(id, record);
    return {
      data: record ? mocks.response : undefined,
      isLoading: false,
      isError: false,
    };
  },
}));

const record: EmployeeUsageRecord = {
  source: "client",
  recordId: "mirror-1",
  title: "调研任务",
  taskType: "arrangement",
  status: "COMPLETED",
  userId: "user-1",
  userName: "同事甲",
  usedAt: "2026-10-09T01:00:00Z",
  timeBasis: "participation.startedAt",
};
const data: EmployeeUsageList = {
  items: [record],
  total: 21,
  page: 1,
  limit: 20,
  modelConsumption: { callCount: 1, totalTokens: 50, costCNY: 0.1 },
  coverage: { legacyClientTaskCount: 3 },
};
function renderRecords(overrides = {}) {
  const props = {
    subscriptionId: "sub-1",
    data,
    isLoading: false,
    isError: false,
    onRetry: vi.fn(),
    page: 1,
    onPageChange: vi.fn(),
    ...overrides,
  };
  render(
    <ThemeProvider>
      <EmployeeUsageRecords {...props} />
    </ThemeProvider>,
  );
  return props;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.response = undefined;
});

describe("EmployeeUsageRecords", () => {
  it("旧员工正文只继承当前批次无节点身份，不借用其他批次或节点的正文与证据", () => {
    const event = (sequence: number, type: string, message: string): ClientTaskMirrorEvent => ({
      id: `legacy-${sequence}`, sequence, type, message, stepKey: null, progress: null,
      occurredAt: record.usedAt, createdAt: record.usedAt,
    });
    const state = event(2, "monitor_state", JSON.stringify({
      version: 1, reportedStatus: "RUNNING", source: "live", observedAt: record.usedAt,
    }));
    render(<EmployeeUsageBody subscriptionId="sub-1" detail={{
      source: "client-legacy", recordId: "mirror-1",
      task: { id: "mirror-1", clientTaskId: "task-1", title: "历史对话" },
      run: { clientRunId: "run-1", status: "RUNNING", queuedAt: null, startedAt: null,
        completedAt: null, usedAt: record.usedAt, timeBasis: "legacy-received" },
      events: [event(1, "model_output", "当前历史正文"),
        { ...state, clientRunId: "run-other" },
        { ...event(3, "model_output", "其他批次正文"), clientRunId: "run-other" },
        { ...event(4, "model_output", "其他节点正文"), participationId: "p-other" }],
    }} />);
    expect(screen.getByText("当前历史正文")).toBeInTheDocument();
    expect(screen.queryByText("其他批次正文")).not.toBeInTheDocument();
    expect(screen.queryByText("其他节点正文")).not.toBeInTheDocument();
    expect(screen.getByText("最后上报状态，来源未核实")).toBeInTheDocument();
  });
  it("参与执行自身的批次与父级矛盾时不展示正文或状态证据", () => {
    render(<EmployeeUsageBody subscriptionId="sub-1" detail={{
      source: "client", recordId: "mirror-1", task: { id: "mirror-1", clientTaskId: "task-1", title: "调研任务" },
      runs: [{ clientRunId: "run-1", queuedAt: record.usedAt, participations: [{
        id: "p-other", clientRunId: "run-other", nodeId: null, title: "其他批次节点", subscriptionName: "小林",
        status: "RUNNING", startedAt: null, completedAt: null, events: [{
          id: "other", sequence: 1, type: "model_output", message: "矛盾批次正文", stepKey: null,
          progress: null, occurredAt: null, createdAt: record.usedAt,
        }],
      }] }],
    }} />);
    expect(screen.queryByText("矛盾批次正文")).not.toBeInTheDocument();
    expect(screen.queryByText("其他批次节点")).not.toBeInTheDocument();
    expect(screen.getByText("暂未收到回复，原因未确认")).toBeInTheDocument();
  });
  it("员工正文继承父级归属，拒绝跨run/node证据，并采用最新状态而非更老匹配项", () => {
    const event = (sequence: number, type: string, message: string): ClientTaskMirrorEvent => ({
      id: `e-${sequence}`, sequence, type, message, stepKey: null, progress: null,
      occurredAt: record.usedAt, createdAt: record.usedAt,
    });
    const state = (sequence: number, reportedStatus: string) => event(sequence, "monitor_state", JSON.stringify({
      version: 1, reportedStatus, source: "live", observedAt: record.usedAt,
    }));
    const manifest = event(4, "content_manifest", JSON.stringify({ version: 1, messageId: "answer", type: "model_output", chunks: 1, source: "canonical", completeness: "complete" }));
    render(<EmployeeUsageBody subscriptionId="sub-1" showMonitorLink={false} detail={{
      source: "client", recordId: "mirror-1", task: { id: "mirror-1", clientTaskId: "task-1", title: "调研任务" },
      runs: [{ clientRunId: "run-1", queuedAt: record.usedAt, participations: [{
        id: "p-1", clientRunId: "run-1", nodeId: "research", title: "研究", subscriptionName: "小林",
        status: "RUNNING", startedAt: null, completedAt: null, events: [
          state(1, "RUNNING"), state(2, "PAUSED"),
          { ...event(3, "model_output", "当前正文"), stepKey: "content:v1:answer:0:1" },
          { ...manifest, participationId: "p-other" }, { ...manifest, id: "wrong-run", clientRunId: "run-other" },
          { ...event(5, "model_output", "其他节点正文"), participationId: "p-other" },
        ],
      }] }],
    }} />);
    expect(screen.getByText("当前正文")).toBeInTheDocument();
    expect(screen.queryByText("其他节点正文")).not.toBeInTheDocument();
    expect(screen.getByText("最后上报状态，来源未核实")).toBeInTheDocument();
    expect(screen.getByText("已收到回复，完整性未核实")).toBeInTheDocument();
    expect(screen.queryByText("已收到完整回复")).not.toBeInTheDocument();
    expect(screen.queryByText(/\{"version"/)).not.toBeInTheDocument();
  });
  it("中断员工无输出保留回复区域，展示同节点恢复结论与停止时间", () => {
    const events: ClientTaskMirrorEvent[] = [
      { id: "state", sequence: 1, type: "monitor_state", message: JSON.stringify({ version: 1, reportedStatus: "INTERRUPTED", source: "local-run", observedAt: record.usedAt, runEndedAt: record.usedAt }), stepKey: null, progress: null, occurredAt: null, createdAt: record.usedAt },
      { id: "recovery", sequence: 2, type: "content_recovery", message: JSON.stringify({ version: 1, reason: "not-generated", checkedAt: record.usedAt, source: "local-history" }), stepKey: null, progress: null, occurredAt: null, createdAt: record.usedAt },
    ];
    render(<EmployeeUsageBody subscriptionId="sub-1" showMonitorLink={false} detail={{
      source: "client", recordId: "mirror-1", task: { id: "mirror-1", clientTaskId: "task-1", title: "调研任务" },
      runs: [{ clientRunId: "run-1", queuedAt: record.usedAt, participations: [{ id: "p-1", clientRunId: "run-1", nodeId: null, title: "研究", subscriptionName: "小林", status: "INTERRUPTED", startedAt: null, completedAt: null, events }] }],
    }} />);
    expect(screen.getByRole("region", { name: "员工回复" })).toHaveTextContent("尚未生成回复");
    expect(screen.getByText(/状态来源：本地运行记录/)).toHaveTextContent("停止时间：");
    expect(screen.getByText(/^已中断 ·/)).toBeInTheDocument();
    expect(screen.queryByText(/\{"version"/)).not.toBeInTheDocument();
  });
  it("旧记录与已核实记录区分，并说明覆盖数量和日期范围", () => {
    renderRecords({ data: {
      ...data,
      items: [{ ...record, source: "client-legacy", taskType: "conversation", timeBasis: "legacy-received" }],
      coverage: { legacyClientTaskCount: 3, readableLegacyClientTaskCount: 2 },
    } });
    expect(screen.getByText("旧客户端记录")).toBeInTheDocument();
    expect(screen.getByText("对话 · 归属未核实")).toBeInTheDocument();
    expect(screen.getByText(/其中 2 项可在员工页读取/)).toBeInTheDocument();
    expect(screen.getByText("接收时间，执行时间未知")).toBeInTheDocument();
    expect(screen.getByText(/历史记录可能早于当前日期范围/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "客户端监控" })).toHaveAttribute(
      "href", "/tasks?tab=monitoring&subscriptionId=sub-1&scopeSubscriptionId=sub-1",
    );
  });

  it("旧记录正文只有一个运行批次，缺片和接收时间明确标注", () => {
    const legacyRecord: EmployeeUsageRecord = {
      ...record, source: "client-legacy", title: "历史对话", timeBasis: "legacy-received",
    };
    mocks.response = {
      source: "client-legacy", recordId: record.recordId,
      task: { id: record.recordId, clientTaskId: "task-1", title: "历史对话" },
      run: {
        clientRunId: "old-run", status: "COMPLETED", queuedAt: null,
        startedAt: null, completedAt: null, usedAt: record.usedAt, timeBasis: "legacy-received",
      },
      events: [{
        id: "legacy-1", clientRunId: "old-run", participationId: null,
        sequence: 1, type: "model_output", stepKey: "content:v1:old:0:2",
        message: "历史输出", progress: null, occurredAt: null, createdAt: record.usedAt,
      }],
    };
    renderRecords({ data: { ...data, items: [legacyRecord] } });
    fireEvent.click(screen.getByRole("button", { name: "查看 历史对话" }));
    expect(mocks.detail).toHaveBeenLastCalledWith("sub-1", legacyRecord);
    expect(screen.getByText(/按任务原始雇佣关系/)).toHaveTextContent("归属未核实");
    expect(screen.queryByRole("combobox", { name: "运行批次" })).not.toBeInTheDocument();
    expect(screen.getByText(/历史输出/)).toHaveTextContent("[缺失片段]");
    expect(screen.getByText(/正文不完整/)).toHaveTextContent("接收于");
    expect(screen.getByText(/已完成 · 接收于/)).toHaveTextContent("执行时间未知");
    expect(screen.getByRole("link", { name: "任务监控" })).toHaveAttribute(
      "href", "/tasks?tab=monitoring&subscriptionId=sub-1&scopeSubscriptionId=sub-1&taskId=mirror-1",
    );
  });

  it("没有旧记录数量的新字段时不猜测可读数，空列表不等于没有消费", () => {
    renderRecords({ data: { ...data, items: [], total: 0 } });
    expect(screen.getByText(/当前服务版本尚未提供/)).toBeInTheDocument();
    expect(screen.getByText("当前筛选下暂无可展示的使用记录")).toBeInTheDocument();
    expect(screen.getByText(/模型账单不代表已同步正文/)).toBeInTheDocument();
  });

  it("旧记录无正文时显示同步状态，监控复用可关闭跳转", () => {
    render(<EmployeeUsageBody subscriptionId="sub-1" showMonitorLink={false} detail={{
      source: "client-legacy", recordId: "mirror-1",
      task: { id: "mirror-1", clientTaskId: "task-1", title: "历史对话" },
      run: { clientRunId: "run-1", status: "COMPLETED", queuedAt: record.usedAt,
        startedAt: null, completedAt: null, usedAt: record.usedAt, timeBasis: "legacy-queued" },
      events: [],
    }} />);
    expect(screen.getByText("暂未收到回复，原因未确认")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "任务监控" })).not.toBeInTheDocument();
  });

  it("监控可复用订阅范围正文而不再生成循环跳转链接", () => {
    render(<EmployeeUsageBody subscriptionId="sub-1" showMonitorLink={false} detail={{
      source: "client", recordId: "mirror-1",
      task: { id: "mirror-1", clientTaskId: "task-1", title: "调研任务" },
      runs: [{ clientRunId: "run-1", queuedAt: record.usedAt, participations: [{
        id: "part-1", clientRunId: "run-1", nodeId: null, title: "资料检索", subscriptionName: "小林",
        status: "COMPLETED", startedAt: null, completedAt: null, events: [{
          id: "event-1", clientRunId: "run-1", participationId: "part-1", sequence: 1, type: "model_output",
          message: "当前员工正文", stepKey: null, progress: null, occurredAt: record.usedAt, createdAt: record.usedAt,
        }],
      }] }],
    }} />);
    expect(screen.getByText("当前员工正文")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "任务监控" })).not.toBeInTheDocument();
  });
  it("列表不预加载正文，翻页保留服务端统一分页", () => {
    const props = renderRecords();
    expect(mocks.detail).toHaveBeenLastCalledWith("sub-1", null);
    expect(screen.getByRole("button", { name: "上一页" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(props.onPageChange).toHaveBeenCalledWith(2);
    fireEvent.click(screen.getByRole("button", { name: "查看 调研任务" }));
    expect(mocks.detail).toHaveBeenLastCalledWith("sub-1", record);
  });

  it("默认最新批次，按参与正文显示缺片与接收时间，监控链接带订阅范围", () => {
    mocks.response = {
      source: "client",
      recordId: "mirror-1",
      task: { id: "mirror-1", clientTaskId: "task-1", title: "调研任务" },
      runs: ["old-run", "new-run"].map((clientRunId, index) => ({
        clientRunId,
        queuedAt: `2026-10-0${index + 8}T01:00:00Z`,
        participations: [
          {
            id: `part-${index}`,
            clientRunId,
            nodeId: "research",
            title: "资料检索",
            subscriptionName: "小林",
            status: "COMPLETED",
            startedAt: null,
            completedAt: null,
            events: [
              {
                id: `event-${index}`,
                clientRunId,
                participationId: `part-${index}`,
                sequence: 1,
                type: "model_output",
                stepKey: "content:v1:body:0:2",
                message: index ? "新批次输出" : "旧批次输出",
                progress: null,
                occurredAt: null,
                createdAt: "2026-10-09T01:01:00Z",
              },
            ],
          },
        ],
      })),
    };
    renderRecords();
    fireEvent.click(screen.getByRole("button", { name: "查看 调研任务" }));
    expect(screen.getByRole("combobox", { name: "运行批次" })).toHaveValue(
      "new-run",
    );
    expect(screen.getByText(/新批次输出/)).toHaveTextContent("[缺失片段]");
    expect(screen.queryByText(/旧批次输出/)).toBeNull();
    expect(screen.getByText(/正文不完整/)).toHaveTextContent("接收于");
    expect(screen.getByText(/正文不完整/)).toHaveTextContent("近似时间");
    expect(screen.getByRole("link", { name: "任务监控" })).toHaveAttribute(
      "href",
      "/tasks?tab=monitoring&subscriptionId=sub-1&scopeSubscriptionId=sub-1&taskId=mirror-1",
    );
    fireEvent.change(screen.getByRole("combobox", { name: "运行批次" }), {
      target: { value: "old-run" },
    });
    expect(screen.getByText(/旧批次输出/)).toBeTruthy();
    expect(screen.queryByText(/新批次输出/)).toBeNull();
  });

  it("Web消息保持输入输出顺序，工具正文默认折叠，文本不执行HTML", () => {
    const webRecord = {
      ...record,
      source: "web-conversation" as const,
      title: "Web调研",
    };
    mocks.response = {
      source: "web-conversation",
      recordId: record.recordId,
      session: { title: webRecord.title },
      messages: [
        {
          id: "m1",
          role: "USER",
          content: "<script>unsafe()</script>",
          createdAt: record.usedAt,
        },
        {
          id: "m2",
          role: "ASSISTANT",
          content: "已整理资料",
          createdAt: record.usedAt,
        },
        {
          id: "m3",
          role: "TOOL",
          content: "检索诊断",
          createdAt: record.usedAt,
        },
      ],
    };
    renderRecords({ data: { ...data, items: [webRecord] } });
    fireEvent.click(screen.getByRole("button", { name: "查看 Web调研" }));
    const text = screen.getByText("<script>unsafe()</script>");
    expect(text.tagName).toBe("PRE");
    expect(text.querySelector("script")).toBeNull();
    expect(screen.getByText("已整理资料")).toBeTruthy();
    expect(screen.getByText("检索诊断").closest("details")).not.toHaveAttribute(
      "open",
    );
  });

  it("刷新失败保留旧数据并明确标注", () => {
    const props = renderRecords({ isError: true });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "当前显示上次读取的数据",
    );
    expect(screen.getByText("调研任务")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    expect(props.onRetry).toHaveBeenCalledOnce();
  });
});
