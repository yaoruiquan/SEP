import { ForbiddenException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { EnterpriseContextService } from "./enterprise-context.service";
import { OrganizationService } from "./organization.service";
import { OrganizationController } from "./organization.controller";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";

describe("OrganizationService", () => {
  const now = new Date("2026-09-16T08:00:00.000Z");
  const context = {
    enterpriseId: "enterprise-1",
    memberId: "member-1",
    role: "MEMBER",
    departmentId: "department-1",
  };
  let prisma: {
    enterprise: { findUniqueOrThrow: jest.Mock };
    subscription: { findMany: jest.Mock };
    employeeGrant: { findMany: jest.Mock };
    department: { findMany: jest.Mock };
    enterpriseMember: { findMany: jest.Mock };
  };
  let contexts: { resolve: jest.Mock };
  let service: OrganizationService;

  const subscription = (
    id: string,
    overrides: Record<string, unknown> = {},
  ) => ({
    id,
    employeeId: `employee-${id}`,
    name: null,
    status: "ACTIVE",
    endDate: null,
    employee: {
      name: `Employee ${id}`,
      avatar: null,
      position: "Analyst",
      description: "Analyses reports",
      status: "APPROVED",
    },
    ...overrides,
  });
  const grant = (
    id: string,
    subscriptionId: string,
    overrides: Record<string, unknown> = {},
  ) => ({
    id,
    subscriptionId,
    memberId: "member-1",
    departmentId: null,
    expiresAt: null,
    ...overrides,
  });

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
    contexts = { resolve: jest.fn().mockResolvedValue({ ...context }) };
    prisma = {
      enterprise: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({
            id: "enterprise-1",
            name: "Example",
            logo: null,
          }),
      },
      subscription: { findMany: jest.fn().mockResolvedValue([]) },
      employeeGrant: { findMany: jest.fn().mockResolvedValue([]) },
      department: { findMany: jest.fn().mockResolvedValue([]) },
      enterpriseMember: { findMany: jest.fn().mockResolvedValue([]) },
    };
    service = new OrganizationService(
      prisma as unknown as PrismaService,
      contexts as unknown as EnterpriseContextService,
    );
  });

  afterEach(() => jest.useRealTimers());

  it("scopes every query to the authenticated enterprise and restricts ordinary member grants", async () => {
    const result = await service.organization("user-1");
    expect(contexts.resolve).toHaveBeenCalledWith("user-1");
    for (const model of [
      prisma.department,
      prisma.enterpriseMember,
      prisma.subscription,
    ]) {
      expect(model.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { enterpriseId: "enterprise-1" } }),
      );
    }
    expect(prisma.enterprise.findUniqueOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "enterprise-1" } }),
    );
    const where = prisma.employeeGrant.findMany.mock.calls[0][0].where;
    expect(where.subscription).toEqual({
      enterpriseId: "enterprise-1",
      status: "ACTIVE",
      OR: [{ endDate: null }, { endDate: { gt: now } }],
    });
    expect(where.AND).toEqual([
      { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      {
        OR: [
          { departmentId: null, member: { enterpriseId: "enterprise-1" } },
          { memberId: null, department: { enterpriseId: "enterprise-1" } },
        ],
      },
      { OR: [{ memberId: "member-1" }, { departmentId: "department-1" }] },
    ]);
    expect(result.permissions).toEqual({
      grantVisibility: "SELF",
      departmentGrantInheritance: "DIRECT_DEPARTMENT_ONLY",
      personalReportingSupported: false,
    });
  });

  it("allows admins to inspect other grants without automatically granting them employee usage", async () => {
    contexts.resolve.mockResolvedValue({
      ...context,
      role: "ENTERPRISE_ADMIN",
    });
    prisma.subscription.findMany.mockResolvedValue([
      subscription("a"),
      subscription("b"),
    ]);
    prisma.employeeGrant.findMany.mockResolvedValue([
      grant("other", "a", { memberId: "other-member" }),
      grant("own-department", "b", {
        memberId: null,
        departmentId: "department-1",
      }),
    ]);
    const result = await service.organization("admin");
    expect(result.grants).toHaveLength(2);
    expect(result.permissions.grantVisibility).toBe("ENTERPRISE");
    expect(result.statistics.currentUserAvailableEmployeeCount).toBe(1);
    expect(result.employees.map((row) => row.currentUserCanUse)).toEqual([
      false,
      true,
    ]);
    expect(
      prisma.employeeGrant.findMany.mock.calls[0][0].where.AND,
    ).toHaveLength(2);
  });

  it("keeps department managers limited to their own direct department and personal grants", async () => {
    contexts.resolve.mockResolvedValue({ ...context, role: "DEPT_MANAGER" });
    await service.organization("manager");
    expect(prisma.employeeGrant.findMany.mock.calls[0][0].where.AND[2]).toEqual(
      {
        OR: [{ memberId: "member-1" }, { departmentId: "department-1" }],
      },
    );
  });

  it("does not match unassigned department grants when a member has no department", async () => {
    contexts.resolve.mockResolvedValue({ ...context, departmentId: null });
    await service.overview("unassigned");
    expect(prisma.employeeGrant.findMany.mock.calls[0][0].where.AND[2]).toEqual(
      { OR: [{ memberId: "member-1" }] },
    );
  });

  it("deduplicates employee counts and includes inactive subscriptions only in total directory counts", async () => {
    prisma.subscription.findMany.mockResolvedValue([
      subscription("a", { employeeId: "shared", name: "Custom name" }),
      subscription("b", { employeeId: "shared" }),
      subscription("c", { status: "PAUSED" }),
      subscription("d", { status: "EXPIRED" }),
      subscription("e", { status: "TERMINATED" }),
      subscription("f", { endDate: now }),
      subscription("g", { endDate: new Date(now.getTime() + 1) }),
    ]);
    prisma.employeeGrant.findMany.mockResolvedValue([
      grant("direct", "a"),
      grant("department", "a", {
        memberId: null,
        departmentId: "department-1",
      }),
      grant("same-employee", "b"),
    ]);
    const result = await service.overview("user-1");
    expect(result.statistics).toEqual({
      employeeCount: 6,
      subscriptionCount: 7,
      activeEmployeeCount: 2,
      currentUserAvailableEmployeeCount: 1,
    });
    expect(result.employees[0].name).toBe("Custom name");
    expect(result.employees[5]).toMatchObject({
      active: false,
      currentUserCanUse: false,
    });
    expect(result.employees[6]).toMatchObject({
      active: true,
      currentUserCanUse: false,
    });
    expect(result).not.toHaveProperty("grants");
  });

  it("returns real member and department leader references without personal contact data or invented reporting lines", async () => {
    prisma.department.findMany.mockResolvedValue([
      {
        id: "department-1",
        name: "Engineering",
        parentId: null,
        leaderId: "member-1",
        sortOrder: 0,
      },
    ]);
    prisma.enterpriseMember.findMany.mockResolvedValue([
      {
        id: "member-1",
        userId: "user-1",
        departmentId: "department-1",
        position: "Engineer",
        user: { name: "Member", avatar: null },
      },
    ]);
    const result = await service.organization("user-1");
    expect(result.departments[0].leaderId).toBe(result.members[0].id);
    expect(result.members[0]).toEqual({
      id: "member-1",
      userId: "user-1",
      departmentId: "department-1",
      position: "Engineer",
      name: "Member",
      avatar: null,
    });
    expect(
      prisma.enterpriseMember.findMany.mock.calls[0][0].select.user.select,
    ).toEqual({ name: true, avatar: true });
  });

  it("returns empty zero-valued statistics when no subscriptions exist", async () => {
    const result = await service.overview("user-1");
    expect(result.statistics).toEqual({
      employeeCount: 0,
      subscriptionCount: 0,
      activeEmployeeCount: 0,
      currentUserAvailableEmployeeCount: 0,
    });
    expect(result.employees).toEqual([]);
  });

  it("rejects a user without enterprise membership before reading any enterprise records", async () => {
    contexts.resolve.mockRejectedValue(new ForbiddenException());
    await expect(service.organization("outsider")).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.enterprise.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(prisma.subscription.findMany).not.toHaveBeenCalled();
    expect(prisma.department.findMany).not.toHaveBeenCalled();
  });

  it("requires JWT authentication and passes only the authenticated user to the service", async () => {
    expect(Reflect.getMetadata("__guards__", OrganizationController)).toEqual([
      JwtAuthGuard,
    ]);
    const controller = new OrganizationController(service);
    await controller.getOverview({ user: { id: "authenticated-user" } });
    expect(contexts.resolve).toHaveBeenCalledWith("authenticated-user");
  });
});
