import { describe, expect, it } from "vitest";
import { businessDateRange, usageQueryString } from "./use-employee-usage";

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
});
