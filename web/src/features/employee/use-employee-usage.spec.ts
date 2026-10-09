import { createElement, type ReactNode } from "react";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { businessDateRange, usageQueryString, useEmployeeUsageDetail } from "./use-employee-usage";

vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn() } }));
const clients: QueryClient[] = [];
beforeEach(() => vi.clearAllMocks());
afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.clear()); });

describe("employee usage filters", () => {
  it("uses UTC+8 business dates across UTC midnight with an exclusive end", () => {
    expect(businessDateRange(7, new Date("2026-10-08T16:00:00Z"))).toEqual({
      from: "2026-10-03",
      to: "2026-10-10",
    });
    expect(businessDateRange(7, new Date("2026-10-08T15:59:59Z"))).toEqual({
      from: "2026-10-02",
      to: "2026-10-09",
    });
  });
  it("encodes member IDs and excludes empty filters", () => {
    expect(
      usageQueryString({ page: 2, userId: "u&1", source: undefined, from: "" }),
    ).toBe("page=2&userId=u%261");
  });

  it("detail keeps the subscription endpoint and cache separate when changing employees", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    clients.push(client);
    const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
    vi.mocked(api.get).mockResolvedValue({ source: "client", runs: [] });
    const { result, rerender } = renderHook(({ subscriptionId }) => useEmployeeUsageDetail(subscriptionId, {
      source: "client", recordId: "mirror/a?b",
    }), { initialProps: { subscriptionId: "sub/1" }, wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.get).toHaveBeenCalledWith("/subscriptions/sub%2F1/usage-records/client/mirror%2Fa%3Fb");
    expect(client.getQueryCache().getAll()[0].options).toHaveProperty("refetchInterval", undefined);
    rerender({ subscriptionId: "sub/2" });
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/subscriptions/sub%2F2/usage-records/client/mirror%2Fa%3Fb"));
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it("legacy details retain a separate source endpoint and cache identity", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    clients.push(client);
    const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
    vi.mocked(api.get).mockResolvedValue({ source: "client-legacy", events: [] });
    const { result } = renderHook(() => useEmployeeUsageDetail("sub-1", {
      source: "client-legacy", recordId: "mirror/a?b",
    }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.get).toHaveBeenCalledWith("/subscriptions/sub-1/usage-records/client-legacy/mirror%2Fa%3Fb");
    expect(client.getQueryCache().getAll()[0].queryKey).toContain("client-legacy");
    expect(usageQueryString({ source: "client-legacy" })).toBe("source=client-legacy");
  });

  it("allows monitor details to retain polling without enabling it for other callers", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    clients.push(client);
    const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
    vi.mocked(api.get).mockResolvedValue({ source: "client", runs: [] });
    const { result } = renderHook(() => useEmployeeUsageDetail("sub-1", {
      source: "client", recordId: "mirror-1",
    }, 10000), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryCache().getAll()[0].options).toHaveProperty("refetchInterval", 10000);
  });
});
