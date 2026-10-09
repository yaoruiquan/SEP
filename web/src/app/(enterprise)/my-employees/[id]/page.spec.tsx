import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import EmployeeDetailPage from "./page";
import { ThemeProvider } from "@/lib/theme-provider";

interface EmployeeDetail {
  capabilities: Array<{
    id: string;
    name: string;
    type: string;
    description: string | null;
    status: string;
    order: number;
    inputSchema: Record<string, unknown> | null;
    outputSchema: Record<string, unknown> | null;
  }>;
}

const mocks = vi.hoisted(() => ({
  role: "ENTERPRISE_ADMIN",
  detail: vi.fn(),
  usage: vi.fn(),
  grants: vi.fn(),
  retry: vi.fn(),
  mutate: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "sub-1" }),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/lib/auth-store", () => ({
  useAuthStore: () => ({ roleInEnterprise: mocks.role }),
}));
vi.mock("@/features/subscription/use-subscriptions", () => ({
  useSubscription: () => ({
    data: {
      id: "sub-1",
      name: "员工小林",
      status: "ACTIVE",
      templateVersion: "1",
      config: {},
      employee: {
        id: "template-1",
        name: "客服",
        description: "处理客户问题",
        avatar: null,
      },
    },
  }),
  useUpdateSubscription: () => ({ mutate: mocks.mutate }),
}));
vi.mock("@/features/enterprise/use-enterprise", () => ({
  useSubscriptionGrants: mocks.grants,
}));
vi.mock("@/features/employee/use-employee-detail", () => ({
  useEmployeeDetail: (subscriptionId: string) => mocks.detail(subscriptionId),
}));
vi.mock("@/features/employee/use-employee-usage", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/features/employee/use-employee-usage")
  >()),
  useEmployeeUsage: mocks.usage,
  useEmployeeUsageDetail: () => ({ data: undefined, isLoading: false }),
}));
vi.mock("@/features/skill-version/use-skill-version", () => ({
  useEmployeeSkillVersions: () => ({ data: { skills: [] } }),
  useCreateEnterpriseSkillVersion: () => ({}),
  useSelectSkillVersion: () => ({}),
}));
vi.mock("@/features/skill-version/SkillVersionPreviewDialog", () => ({
  SkillVersionPreviewDialog: () => null,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.role = "ENTERPRISE_ADMIN";
  mocks.detail.mockImplementation(
    () =>
      ({
        data: { capabilities: [] },
        isLoading: false,
        isError: false,
        refetch: mocks.retry,
      }) as any,
  );
  mocks.grants.mockReturnValue({
    data: [],
    isLoading: false,
    isError: false,
  } as any);
  mocks.usage.mockReturnValue({
    data: {
      items: [],
      total: 0,
      limit: 20,
      page: 1,
      members: [{ userId: "member-1", userName: "同事甲" }],
      coverage: { legacyClientTaskCount: 2 },
      modelConsumption: {
        callCount: 8,
        totalTokens: 1200,
        costCNY: 0.5,
      },
    },
    isLoading: false,
    isError: false,
  } as any);
});

describe("EmployeeDetailPage", () => {
  it("使用订阅 ID 读取能力和使用数据，时间范围统一切换", () => {
    render(
      <ThemeProvider>
        <EmployeeDetailPage />
      </ThemeProvider>,
    );
    expect(mocks.detail).toHaveBeenCalledWith("sub-1");
    expect(mocks.usage).toHaveBeenCalledWith(
      "sub-1",
      expect.objectContaining({ page: 1, limit: 20 }),
    );
    expect(screen.getByText(/本企业使用情况/)).toBeTruthy();
    expect(screen.getByText("模型调用")).toBeTruthy();
    expect(screen.queryByText("今日调用")).toBeNull();
    expect(screen.queryByText("累计费用")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "近 30 天" }));
    const previous = mocks.usage.mock.calls.at(-1)![1];
    expect(
      (Date.parse(previous.to) - Date.parse(previous.from)) / 86400000,
    ).toBe(30);
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "概览",
      "能力",
      "使用记录",
    ]);
    expect(screen.queryByText("能力执行成功率")).toBeNull();
    expect(screen.queryByText("最近执行")).toBeNull();
  });
  it("能力接口失败显示重试，不假装没有能力", () => {
    mocks.detail.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error("Failed to load"),
      refetch: mocks.retry,
    } as any);
    render(
      <ThemeProvider>
        <EmployeeDetailPage />
      </ThemeProvider>,
    );
    fireEvent.mouseDown(screen.getByRole("tab", { name: "能力" }));
    expect(screen.getByRole("alert")).toHaveTextContent("能力加载失败");
    expect(screen.queryByText("暂未绑定能力")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    expect(mocks.retry).toHaveBeenCalledOnce();
  });
  it("真实空能力显示空态，标题旁改名只提交name", () => {
    render(
      <ThemeProvider>
        <EmployeeDetailPage />
      </ThemeProvider>,
    );
    fireEvent.mouseDown(screen.getByRole("tab", { name: "能力" }));
    expect(screen.getByText("暂未绑定能力")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "编辑配置" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "修改名称" }));
    expect(screen.getByDisplayValue("员工小林")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "员工名称" }), {
      target: { value: " 新名称 " },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存名称" }));
    expect(mocks.mutate).toHaveBeenCalledWith(
      { id: "sub-1", name: "新名称" },
      expect.any(Object),
    );
    expect(
      screen.queryByRole("button", { name: /暂停使用|恢复使用/ }),
    ).toBeNull();
  });
  it.each(["MEMBER", "DEPT_MANAGER"])(
    "%s只显示个人范围，不查询企业授权名单",
    (role) => {
      mocks.role = role;
      render(
        <ThemeProvider>
          <EmployeeDetailPage />
        </ThemeProvider>,
      );
      expect(screen.getByText(/我的使用情况/)).toBeTruthy();
      expect(mocks.grants).toHaveBeenCalledWith("");
      expect(screen.queryByText("授权范围")).toBeNull();
      expect(screen.queryByRole("button", { name: "修改名称" })).toBeNull();
      expect(screen.queryByRole("combobox", { name: "成员筛选" })).toBeNull();
      expect(mocks.usage).toHaveBeenLastCalledWith(
        "sub-1",
        expect.objectContaining({ userId: undefined }),
      );
    },
  );
  it("统计失败不展示零记录或零消费", () => {
    mocks.usage.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: mocks.retry,
    } as any);
    render(
      <ThemeProvider>
        <EmployeeDetailPage />
      </ThemeProvider>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("使用数据加载失败");
    expect(screen.queryByText("暂无执行记录")).toBeNull();
    expect(screen.queryByText("¥0.0000")).toBeNull();
  });
  it("成员和来源筛选跟随同一时间范围，非法日期不发请求", () => {
    render(
      <ThemeProvider>
        <EmployeeDetailPage />
      </ThemeProvider>,
    );
    fireEvent.change(screen.getByRole("combobox", { name: "成员筛选" }), {
      target: { value: "member-1" },
    });
    expect(mocks.usage).toHaveBeenLastCalledWith(
      "sub-1",
      expect.objectContaining({ userId: "member-1", page: 1 }),
    );
    fireEvent.mouseDown(screen.getByRole("tab", { name: "使用记录" }));
    fireEvent.change(screen.getByRole("combobox", { name: "来源筛选" }), {
      target: { value: "client" },
    });
    expect(mocks.usage).toHaveBeenLastCalledWith(
      "sub-1",
      expect.objectContaining({ source: "client", userId: "member-1" }),
    );
    fireEvent.change(screen.getByRole("combobox", { name: "使用时间排序" }), {
      target: { value: "asc" },
    });
    expect(mocks.usage).toHaveBeenLastCalledWith(
      "sub-1",
      expect.objectContaining({ order: "asc", page: 1 }),
    );
    fireEvent.change(screen.getByLabelText("开始日期"), {
      target: { value: "2030-01-01" },
    });
    expect(mocks.usage).toHaveBeenLastCalledWith("", expect.any(Object));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "截止日期必须晚于开始日期",
    );
  });
});
