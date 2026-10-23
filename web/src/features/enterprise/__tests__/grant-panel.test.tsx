import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GrantPanel } from "../grant-panel";
import type { Subscription } from "@/lib/types";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  remove: vi.fn(),
  state: {
    grants: [] as any[],
    members: [] as any[],
    error: false,
    candidateError: false,
    pending: false,
  },
}));
vi.mock("../use-enterprise", () => ({
  useSubscriptionGrants: () => ({
    data: mocks.state.grants,
    isLoading: false,
    isError: mocks.state.error,
  }),
  useDepartments: () => ({
    data: [
      { id: "dept-1", name: "研发部", children: [] },
      { id: "dept-2", name: "设计部", children: [] },
    ],
    isLoading: false,
    isError: mocks.state.error,
  }),
  useMembers: () => ({
    data: mocks.state.members,
    isLoading: false,
    isError: mocks.state.error || mocks.state.candidateError,
  }),
  useCreateGrants: () => ({
    mutateAsync: mocks.create,
    isPending: mocks.state.pending,
  }),
  useDeleteGrant: () => ({ mutate: mocks.remove, isPending: false }),
}));
vi.mock("@/components/ui/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const subscription = { id: "subscription-1", name: "助理" } as Subscription;
const member = (id: string, name = id) => ({
  id,
  position: "工程师",
  user: { name, email: `${id}@example.com` },
  department: { id: "dept-1", name: "研发部" },
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.state.grants = [];
  mocks.state.error = false;
  mocks.state.candidateError = false;
  mocks.state.pending = false;
  mocks.state.members = [
    member("member-1", "李四"),
    member("member-2", "王五"),
  ];
  mocks.create.mockResolvedValue({
    target: "member",
    createdIds: ["member-1"],
    renewedIds: [],
    skippedIds: [],
  });
});
afterEach(() => vi.useRealTimers());

describe("员工批量授权面板", () => {
  it("自定义未来时间使用本地时区的最小值并按 UTC 提交", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 23, 23, 0));
    render(<GrantPanel subscription={subscription} onClose={() => {}} />);
    fireEvent.click(screen.getByText("李四"));
    fireEvent.click(screen.getByRole("button", { name: "自定义" }));
    const input = document.querySelector<HTMLInputElement>('input[type="datetime-local"]')!;
    expect(input.min).toBe("2026-10-23T23:00");
    fireEvent.change(input, { target: { value: "2026-10-23T23:30" } });
    expect(input.validity.rangeUnderflow).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "授权给 1 个成员" }));
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      expiresAt: new Date(2026, 9, 23, 23, 30).toISOString(),
    }));
  });

  it("候选读取失败仍可查看过期日期并收回已有授权", () => {
    mocks.state.candidateError = true;
    mocks.state.grants = [{
      id: "expired", member: { id: "member-1", name: "李四" },
      department: null, expired: true, expiresAt: "2020-01-01T00:00:00.000Z",
    }];
    render(<GrantPanel subscription={subscription} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /已有授权/ }));
    expect(screen.getByText(`已过期：${new Date("2020-01-01T00:00:00.000Z").toLocaleString("zh-CN")}`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "收回" }));
    expect(mocks.remove).toHaveBeenCalledWith(expect.objectContaining({ grantId: "expired" }), expect.anything());
  });

  it("重复点击当前授权对象类型不会清空选择", () => {
    render(<GrantPanel subscription={subscription} onClose={() => {}} />);
    fireEvent.click(screen.getByText("李四"));
    fireEvent.click(screen.getByRole("button", { name: "给个人" }));
    expect(screen.getByText("已选 1/100")).toBeInTheDocument();
  });
  it("成员多选、跨页选择后一次提交", async () => {
    mocks.state.members = Array.from({ length: 21 }, (_, i) =>
      member(`member-${i + 1}`),
    );
    render(<GrantPanel subscription={subscription} onClose={() => {}} />);
    fireEvent.click(screen.getByText("member-1"));
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    fireEvent.click(screen.getByText("member-21"));
    expect(screen.getByText("已选 2/100")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "授权给 2 个成员" }));
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({ memberIds: ["member-1", "member-21"] }),
      ),
    );
  });

  it("支持部门多选、搜索和已有授权撤回", () => {
    mocks.state.grants = [
      {
        id: "grant-1",
        member: { id: "member-1", name: "张三", email: "zhang@example.com" },
        department: null,
        expired: false,
        expiresAt: null,
      },
    ];
    render(<GrantPanel subscription={subscription} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "给部门" }));
    fireEvent.change(screen.getByPlaceholderText("搜索部门路径"), {
      target: { value: "研发" },
    });
    fireEvent.click(screen.getAllByText("研发部")[0]);
    expect(screen.getByText("已选 1/100")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("搜索部门路径"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getAllByText("设计部")[0]);
    expect(screen.getByText("已选 2/100")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "授权给 2 个部门" }));
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ departmentIds: ["dept-1", "dept-2"] }),
    );
  });

  it("保留已有授权单条撤回", () => {
    mocks.state.grants = [
      {
        id: "grant-1",
        member: { id: "member-1", name: "张三", email: "zhang@example.com" },
        department: null,
        expired: false,
        expiresAt: null,
      },
    ];
    render(<GrantPanel subscription={subscription} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /已有授权/ }));
    fireEvent.click(screen.getByRole("button", { name: "收回" }));
    expect(mocks.remove).toHaveBeenCalledWith(
      expect.objectContaining({ grantId: "grant-1" }),
      expect.anything(),
    );
  });

  it("有效授权禁选，过期授权需开启重开且取消后移除", () => {
    mocks.state.grants = [
      {
        id: "active",
        member: { id: "member-1", name: "李四", email: "member-1@example.com" },
        department: null,
        expired: false,
        expiresAt: null,
      },
      {
        id: "expired",
        member: { id: "member-2", name: "王五", email: "member-2@example.com" },
        department: null,
        expired: true,
        expiresAt: "2020-01-01T00:00:00.000Z",
      },
    ];
    render(<GrantPanel subscription={subscription} onClose={() => {}} />);
    expect(
      screen.getByText("李四").closest("label")?.querySelector("button"),
    ).toBeDisabled();
    fireEvent.click(screen.getByText("王五"));
    expect(screen.getByText("已选 0/100")).toBeInTheDocument();
    fireEvent.click(screen.getByText("重新开通过期授权"));
    fireEvent.click(screen.getByText("王五"));
    expect(screen.getByText("已选 1/100")).toBeInTheDocument();
    fireEvent.click(screen.getByText("重新开通过期授权"));
    expect(screen.getByText("已选 0/100")).toBeInTheDocument();
  });

  it("读取失败禁止提交，提交失败保留选择，pending 禁止编辑", async () => {
    mocks.state.error = true;
    const failedRead = render(
      <GrantPanel subscription={subscription} onClose={() => {}} />,
    );
    expect(screen.getByRole("button", { name: /授权给/ })).toBeDisabled();
    expect(screen.queryByText("还没有任何授权")).not.toBeInTheDocument();
    failedRead.unmount();

    mocks.state.error = false;
    mocks.create.mockRejectedValueOnce(new Error("request failed"));
    const failedSubmit = render(
      <GrantPanel subscription={subscription} onClose={() => {}} />,
    );
    fireEvent.click(screen.getByText("李四"));
    fireEvent.click(screen.getByRole("button", { name: "授权给 1 个成员" }));
    await waitFor(() =>
      expect(screen.getByText("已选 1/100")).toBeInTheDocument(),
    );
    expect(mocks.create).toHaveBeenCalledTimes(1);
    failedSubmit.unmount();

    mocks.state.pending = true;
    render(<GrantPanel subscription={subscription} onClose={() => {}} />);
    expect(screen.getByPlaceholderText(/搜索姓名/)).toBeDisabled();
    expect(screen.getByRole("button", { name: "给部门" })).toBeDisabled();
    expect(
      screen
        .getAllByRole("button", { name: "关闭" })
        .some((button) => (button as HTMLButtonElement).disabled),
    ).toBe(true);
  });

  it("最多选择 100 个对象", () => {
    mocks.state.members = Array.from({ length: 101 }, (_, i) =>
      member(`member-${i + 1}`),
    );
    render(<GrantPanel subscription={subscription} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "全选本页" }));
    for (let page = 1; page < 6; page += 1) {
      fireEvent.click(screen.getByRole("button", { name: "下一页" }));
      fireEvent.click(screen.getByRole("checkbox", { name: "全选本页" }));
    }
    expect(screen.getByText(/已选 100\/100/)).toBeInTheDocument();
  });
});
