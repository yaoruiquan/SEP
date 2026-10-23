"use client";

import { useMemo, useState } from "react";
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Search,
  Trash2,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/feedback";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { ApiError } from "@/lib/api-client";
import {
  EMPLOYEE_GRANT_BATCH_LIMIT,
  GrantBatchCreateDtoSchema,
} from "shared/employee-grant.dto";
import {
  useSubscriptionGrants,
  useCreateGrants,
  useDeleteGrant,
  useDepartments,
  useMembers,
} from "./use-enterprise";
import { flattenDepts } from "./flatten-depts";
import type { GrantRecord, Subscription } from "@/lib/types";

const PAGE_SIZE = 20;
type Target = "member" | "department";
type Term = "forever" | "30" | "90" | "custom";

function errorMessage(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

export function GrantPanel({
  subscription,
  onClose,
}: {
  subscription: Subscription;
  onClose: () => void;
}) {
  const grantsQuery = useSubscriptionGrants(subscription.id);
  const departmentsQuery = useDepartments();
  const membersQuery = useMembers();
  const createGrants = useCreateGrants();
  const deleteGrant = useDeleteGrant();
  const grants = useMemo(() => grantsQuery.data ?? [], [grantsQuery.data]);
  const departments = useMemo(
    () => departmentsQuery.data ?? [],
    [departmentsQuery.data],
  );
  const members = useMemo(() => membersQuery.data ?? [], [membersQuery.data]);
  const [view, setView] = useState<"new" | "existing">("new");
  const [target, setTarget] = useState<Target>("member");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [renewExpired, setRenewExpired] = useState(false);
  const [term, setTerm] = useState<Term>("forever");
  const [customDate, setCustomDate] = useState("");
  const [minCustomDate] = useState(() => {
    const now = new Date();
    return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });
  const flatDepartments = useMemo(
    () => flattenDepts(departments),
    [departments],
  );
  const departmentPath = useMemo(
    () => new Map(flatDepartments.map((d) => [d.id, d.label])),
    [flatDepartments],
  );
  const activeDirect = useMemo(
    () =>
      new Set(
        grants.filter((g) => g.member && !g.expired).map((g) => g.member!.id),
      ),
    [grants],
  );
  const expiredDirect = useMemo(
    () =>
      new Set(
        grants.filter((g) => g.member && g.expired).map((g) => g.member!.id),
      ),
    [grants],
  );
  const activeDepartments = useMemo(
    () =>
      new Set(
        grants
          .filter((g) => g.department && !g.expired)
          .map((g) => g.department!.id),
      ),
    [grants],
  );
  const expiredDepartments = useMemo(
    () =>
      new Set(
        grants
          .filter((g) => g.department && g.expired)
          .map((g) => g.department!.id),
      ),
    [grants],
  );
  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (target === "department")
      return flatDepartments.filter(
        (d) => !q || d.label.toLowerCase().includes(q),
      );
    return members.filter((m) =>
      [m.user.name, m.user.email, m.position, m.department?.name]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [flatDepartments, members, search, target]);
  const totalPages = Math.max(1, Math.ceil(candidates.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = candidates.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );
  const isDisabled = (id: string) =>
    target === "member"
      ? activeDirect.has(id) || (expiredDirect.has(id) && !renewExpired)
      : activeDepartments.has(id) ||
        (expiredDepartments.has(id) && !renewExpired);
  const selectablePage = pageItems
    .filter((item) => !isDisabled(item.id))
    .map((item) => item.id);
  const allPageSelected =
    selectablePage.length > 0 && selectablePage.every((id) => selected.has(id));
  const switchTarget = (next: Target) => {
    if (createGrants.isPending || next === target) return;
    setTarget(next);
    setSelected(new Set());
    setSearch("");
    setPage(1);
    setRenewExpired(false);
  };
  const toggle = (id: string, checked: boolean) => {
    if (createGrants.isPending || isDisabled(id)) return;
    setSelected((current) => {
      const next = new Set(current);
      if (checked) {
        if (next.size < EMPLOYEE_GRANT_BATCH_LIMIT) next.add(id);
      } else next.delete(id);
      return next;
    });
  };
  const selectPage = () =>
    setSelected((current) => {
      const next = new Set(current);
      if (allPageSelected) selectablePage.forEach((id) => next.delete(id));
      else
        selectablePage.forEach((id) => {
          if (next.size < EMPLOYEE_GRANT_BATCH_LIMIT) next.add(id);
        });
      return next;
    });
  const expiresAt = () => {
    if (term === "forever") return undefined;
    if (term === "custom") {
      if (!customDate) return undefined;
      const date = new Date(customDate);
      return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
    }
    return new Date(Date.now() + Number(term) * 86400000).toISOString();
  };
  const submit = async () => {
    if (createGrants.isPending) return;
    if (
      !selected.size ||
      selected.size > EMPLOYEE_GRANT_BATCH_LIMIT ||
      grantsQuery.isError ||
      departmentsQuery.isError ||
      membersQuery.isError
    )
      return;
    const iso = expiresAt();
    if (term === "custom" && (!iso || new Date(iso).getTime() <= Date.now())) {
      toast.error("自定义到期时间必须晚于当前时间");
      return;
    }
    const payload = {
      ...(target === "member"
        ? { memberIds: [...selected] }
        : { departmentIds: [...selected] }),
      ...(iso ? { expiresAt: iso } : {}),
      renewExpired,
    };
    const parsed = GrantBatchCreateDtoSchema.safeParse(payload);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message || "授权参数无效");
      return;
    }
    try {
      const result = await createGrants.mutateAsync({
        subscriptionId: subscription.id,
        ...payload,
      });
      toast.success(
        `新增 ${result.createdIds.length}、重新开通 ${result.renewedIds.length}、跳过 ${result.skippedIds.length}`,
      );
      setSelected(new Set());
      setRenewExpired(false);
      setView("existing");
    } catch (error) {
      toast.error(errorMessage(error, "批量授权失败"));
    }
  };
  const loading =
    grantsQuery.isLoading ||
    departmentsQuery.isLoading ||
    membersQuery.isLoading;
  const readError =
    grantsQuery.isError || departmentsQuery.isError || membersQuery.isError;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !createGrants.isPending) onClose();
      }}
    >
      <DialogContent
        className="flex max-h-[88vh] w-[min(680px,calc(100vw-24px))] flex-col gap-0 p-0"
        onEscapeKeyDown={(event) => {
          if (createGrants.isPending) event.preventDefault();
        }}
      >
        <DialogHeader className="shrink-0 border-b border-border px-5 py-4 text-left">
          <DialogTitle className="pr-6 break-words">
            授权管理 ·{" "}
            {subscription.name || subscription.employee?.name || "硅基员工"}
          </DialogTitle>
          <DialogDescription>
            为一个硅基员工授权给多个成员或部门
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="mb-4 flex gap-1 rounded border border-border p-0.5">
            <button
              className={`flex-1 rounded px-3 py-2 text-sm ${view === "new" ? "bg-primary-subtle font-medium text-primary" : "text-fg-muted"}`}
              onClick={() => setView("new")}
            >
              新增授权
            </button>
            <button
              className={`flex-1 rounded px-3 py-2 text-sm ${view === "existing" ? "bg-primary-subtle font-medium text-primary" : "text-fg-muted"}`}
              onClick={() => setView("existing")}
            >
              已有授权{" "}
              <span className="text-xs text-fg-subtle">{grants.length}</span>
            </button>
          </div>
          {(view === "existing" ? grantsQuery.isError : readError) && (
            <p className="mb-3 rounded border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
              {view === "existing" ? "已有授权读取失败，请刷新后重试。" : "候选成员、部门或已有授权读取失败，请刷新后重试。"}
            </p>
          )}
          {view === "existing" ? (
            <div className="space-y-2">
              {grantsQuery.isLoading ? (
                <Spinner />
              ) : grantsQuery.isError ? null : grants.length === 0 ? (
                <p className="py-8 text-center text-sm text-fg-muted">
                  还没有任何授权
                </p>
              ) : (
                grants.map((g: GrantRecord) => (
                  <div
                    key={g.id}
                    className={`flex items-center gap-2 rounded border border-border px-3 py-2 ${g.expired ? "opacity-60" : ""}`}
                  >
                    {g.department ? (
                      <Building2 className="h-4 w-4 shrink-0 text-fg-muted" />
                    ) : (
                      <Users className="h-4 w-4 shrink-0 text-fg-muted" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">
                        {g.department
                          ? `${g.department.name}（直属部门）`
                          : g.member?.name || g.member?.email}
                      </p>
                      <p className="truncate text-xs text-fg-subtle">
                        {g.member?.email ? `${g.member.email} · ` : ""}
                        {g.expiresAt
                          ? `${g.expired ? "已过期" : "到期"}：${new Date(g.expiresAt).toLocaleString("zh-CN")}`
                          : "长期有效"}
                        {g.department ? " · 仅覆盖直属成员，不含子部门" : ""}
                      </p>
                    </div>
                    <button
                      title="收回"
                      aria-label="收回"
                      disabled={deleteGrant.isPending || createGrants.isPending}
                      onClick={() =>
                        deleteGrant.mutate(
                          { grantId: g.id, subscriptionId: subscription.id },
                          {
                            onSuccess: () => toast.success("已收回"),
                            onError: (e) =>
                              toast.error(errorMessage(e, "收回失败")),
                          },
                        )
                      }
                      className="rounded p-1 text-fg-muted hover:bg-danger/10 hover:text-danger"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex gap-1 rounded border border-border p-0.5">
                <button
                  disabled={createGrants.isPending}
                  className={`flex-1 rounded px-3 py-2 text-sm ${target === "member" ? "bg-primary-subtle font-medium text-primary" : "text-fg-muted"}`}
                  onClick={() => switchTarget("member")}
                >
                  给个人
                </button>
                <button
                  disabled={createGrants.isPending}
                  className={`flex-1 rounded px-3 py-2 text-sm ${target === "department" ? "bg-primary-subtle font-medium text-primary" : "text-fg-muted"}`}
                  onClick={() => switchTarget("department")}
                >
                  给部门
                </button>
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-fg-muted" />
                <Input
                  disabled={createGrants.isPending}
                  className="pl-9"
                  placeholder={
                    target === "member"
                      ? "搜索姓名、邮箱、部门或岗位"
                      : "搜索部门路径"
                  }
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                />
              </div>
              <div className="flex items-center justify-between text-sm">
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={allPageSelected}
                    onCheckedChange={selectPage}
                    disabled={
                      createGrants.isPending || selectablePage.length === 0
                    }
                  />
                  全选本页
                </label>
                <span className="text-fg-muted">
                  已选 {selected.size}/{EMPLOYEE_GRANT_BATCH_LIMIT}
                  {selected.size >= EMPLOYEE_GRANT_BATCH_LIMIT && (
                    <span className="ml-2 text-danger">已达上限</span>
                  )}
                </span>
              </div>
              <div className="divide-y rounded border border-border">
                {loading ? (
                  <div className="p-6">
                    <Spinner />
                  </div>
                ) : pageItems.length === 0 ? (
                  <p className="p-6 text-center text-sm text-fg-muted">
                    没有匹配的对象
                  </p>
                ) : (
                  pageItems.map((item) => {
                    const candidate = item as (typeof members)[number] & {
                      label?: string;
                    };
                    const disabled = isDisabled(candidate.id);
                    const checked = selected.has(candidate.id);
                    const member = target === "member" ? candidate : null;
                    const label = member
                      ? member.user.name || member.user.email
                      : departmentPath.get(candidate.id) ||
                        candidate.label ||
                        candidate.id;
                    const detail = member
                      ? `${member.user.email} · ${member.department?.name || "未分配部门"}${member.position ? ` · ${member.position}` : ""}`
                      : candidate.label || "";
                    const source =
                      member &&
                      !activeDirect.has(candidate.id) &&
                      member.department &&
                      activeDepartments.has(member.department.id)
                        ? "部门已授权，仍可追加个人授权"
                        : null;
                    return (
                      <label
                        key={candidate.id}
                        className={`flex cursor-pointer items-start gap-3 px-3 py-2.5 ${disabled ? "cursor-not-allowed opacity-50" : "hover:bg-muted/50"}`}
                      >
                        <Checkbox
                          checked={checked}
                          disabled={disabled || createGrants.isPending}
                          onCheckedChange={(value) =>
                            toggle(candidate.id, value === true)
                          }
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block break-words text-sm">
                            {label}
                            {disabled && (
                              <span className="ml-2 text-xs text-fg-subtle">
                                {activeDirect.has(candidate.id) ||
                                activeDepartments.has(candidate.id)
                                  ? "已授权"
                                  : "已过期"}
                              </span>
                            )}
                          </span>
                          <span className="block break-words text-xs text-fg-muted">
                            {detail}
                          </span>
                          {source && (
                            <span className="block text-xs text-primary">
                              {source}
                            </span>
                          )}
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
              <div className="flex items-center justify-between text-sm text-fg-muted">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={createGrants.isPending || safePage <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                  上一页
                </Button>
                <span>
                  第 {safePage} / {totalPages} 页
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={createGrants.isPending || safePage >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  下一页
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
              <button
                className="text-left text-sm text-fg-muted underline"
                disabled={createGrants.isPending || selected.size === 0}
                onClick={() => setSelected(new Set())}
              >
                清空选择
              </button>
              <div className="border-t border-border pt-4">
                <p className="mb-2 text-sm font-medium">有效期</p>
                <div className="flex flex-wrap gap-2">
                  {(["forever", "30", "90", "custom"] as Term[]).map(
                    (value) => (
                      <button
                        disabled={createGrants.isPending}
                        key={value}
                        onClick={() => setTerm(value)}
                        className={`rounded border px-3 py-1.5 text-sm ${term === value ? "border-primary bg-primary-subtle text-primary" : "border-border"}`}
                      >
                        {value === "forever"
                          ? "长期有效"
                          : value === "custom"
                            ? "自定义"
                            : `${value} 天`}
                      </button>
                    ),
                  )}
                </div>
                {term === "custom" && (
                  <Input
                    disabled={createGrants.isPending}
                    className="mt-2"
                    type="datetime-local"
                    value={customDate}
                    min={minCustomDate}
                    onChange={(e) => setCustomDate(e.target.value)}
                  />
                )}
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  disabled={createGrants.isPending}
                  checked={renewExpired}
                  onCheckedChange={(value) => {
                    const enabled = value === true;
                    setRenewExpired(enabled);
                    if (!enabled)
                      setSelected(
                        (current) =>
                          new Set(
                            [...current].filter(
                              (id) =>
                                !expiredDirect.has(id) &&
                                !expiredDepartments.has(id),
                            ),
                          ),
                      );
                  }}
                />
                重新开通过期授权
              </label>
            </div>
          )}
        </div>
        <DialogFooter className="shrink-0 border-t border-border px-5 py-3 sm:flex-row sm:justify-between">
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={createGrants.isPending}
          >
            关闭
          </Button>
          {view === "new" && (
            <Button
              onClick={submit}
              disabled={
                createGrants.isPending || selected.size === 0 || readError
              }
            >
              {createGrants.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              授权给 {selected.size} 个{target === "member" ? "成员" : "部门"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
