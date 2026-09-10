import { BadRequestException } from "@nestjs/common";
import { AuditService, AUDIT_EXPORT_MAX_ROWS } from "./audit.service";

describe("AuditService 查询与导出边界", () => {
  let prisma: any;
  let service: AuditService;

  const actor = {
    userId: "admin-1",
    role: "ADMIN" as const,
  };

  const log = {
    createdAt: new Date("2026-09-10T08:00:00.000Z"),
    actor: { name: "管理员", email: "admin@example.com" },
    enterprise: { name: "示例企业" },
    action: "USER_UPDATE",
    resourceType: "USER",
    resourceId: "user-1",
    result: "SUCCESS",
    summary: "更新用户",
  };

  beforeEach(() => {
    prisma = {
      auditLog: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([log]),
        create: jest.fn(),
      },
    };
    service = new AuditService(prisma);
  });

  it("列表分页始终限制为 1..100", async () => {
    const result = await service.list(actor, { page: 0, pageSize: 99_999 });

    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(100);
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 100 }),
    );

    await service.list(actor, { page: 2, pageSize: 20 });
    expect(prisma.auditLog.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ skip: 20, take: 20 }),
    );
  });

  it("导出查询不复用列表的 100 条上限", async () => {
    prisma.auditLog.count.mockResolvedValue(AUDIT_EXPORT_MAX_ROWS);
    prisma.auditLog.findMany.mockResolvedValue([log]);

    const csv = await service.csv(actor, {});

    expect(csv).toContain("管理员");
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: AUDIT_EXPORT_MAX_ROWS }),
    );
  });

  it("超过导出上限时明确失败，绝不静默截断", async () => {
    prisma.auditLog.count.mockResolvedValue(AUDIT_EXPORT_MAX_ROWS + 1);

    await expect(service.csv(actor, {})).rejects.toThrow(BadRequestException);
    await expect(service.csv(actor, {})).rejects.toThrow(
      "请缩小时间范围或分批导出",
    );
    expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
  });

  it("拒绝无效或倒置日期范围", async () => {
    await expect(
      service.list(actor, { from: new Date("invalid") }),
    ).rejects.toThrow("from 必须是有效日期");
    await expect(
      service.list(actor, {
        from: new Date("2026-09-10"),
        to: new Date("2026-09-01"),
      }),
    ).rejects.toThrow("from 不能晚于 to");
    expect(prisma.auditLog.count).not.toHaveBeenCalled();
  });
});
