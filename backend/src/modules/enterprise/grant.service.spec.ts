import { Test } from "@nestjs/testing";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { GrantService } from "./grant.service";
import { EnterpriseContextService } from "./enterprise-context.service";
import { PackageService } from "../digital-employee/package.service";
import { PrismaService } from "../../prisma/prisma.service";

const ADMIN_CTX = {
  enterpriseId: "ent-a",
  memberId: "m-admin",
  role: "ENTERPRISE_ADMIN" as const,
  departmentId: "d-1",
};

/** 造一条 findMany 返回的授权行 */
const grantRow = (subscriptionId: string, expiresAt: Date | null = null) => ({
  expiresAt,
  subscription: {
    id: subscriptionId,
    name: `雇佣关系 ${subscriptionId}`,
    templateVersion: "1.0.0",
    employee: { id: "t1", name: "客服", avatar: null },
  },
});

describe("GrantService", () => {
  let service: GrantService;
  let prisma: any;
  let ctx: any;
  let packages: any;

  beforeEach(async () => {
    prisma = {
      employeeGrant: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        create: jest.fn(),
        delete: jest.fn(),
      },
      subscription: { findUnique: jest.fn() },
      department: { findUnique: jest.fn() },
      enterpriseMember: { findUnique: jest.fn() },
      // myEmployees 会批量补上每个员工的赠送余额；默认「没有赠送记录」
      subscriptionCredit: { findMany: jest.fn().mockResolvedValue([]) },
    };
    ctx = {
      resolve: jest.fn().mockResolvedValue(ADMIN_CTX),
      assertEnterpriseAdmin: jest.fn(),
    };
    packages = {
      // 默认无包 —— 测 myEmployees 时不关心 packageAvailable 的具体值
      employeeIdsWithPackage: jest.fn().mockResolvedValue(new Set()),
    };

    const mod = await Test.createTestingModule({
      providers: [
        GrantService,
        { provide: PrismaService, useValue: prisma },
        { provide: EnterpriseContextService, useValue: ctx },
        // 只用于给 myEmployees 标注 packageAvailable，默认「都没有包」
        { provide: PackageService, useValue: packages },
      ],
    }).compile();

    service = mod.get(GrantService);
  });

  describe("myEmployees —— 两条授权路径合并", () => {
    it("直接授权与部门授权都返回", async () => {
      prisma.employeeGrant.findMany
        .mockResolvedValueOnce([grantRow("i-direct")]) // 直接
        .mockResolvedValueOnce([grantRow("i-dept")]); // 部门

      const rows = await service.myEmployees("u1");

      expect(rows).toHaveLength(2);
      expect(rows.find((r) => r.subscriptionId === "i-direct")?.grantSource).toBe(
        "DIRECT",
      );
      expect(rows.find((r) => r.subscriptionId === "i-dept")?.grantSource).toBe(
        "DEPARTMENT",
      );
    });

    it("同一雇佣关系两条路径都命中时只返回一条，直接授权优先", async () => {
      prisma.employeeGrant.findMany
        .mockResolvedValueOnce([grantRow("i-same")])
        .mockResolvedValueOnce([grantRow("i-same")]);

      const rows = await service.myEmployees("u1");

      expect(rows).toHaveLength(1);
      expect(rows[0].grantSource).toBe("DIRECT");
    });

    it("成员不属于任何部门时跳过部门查询", async () => {
      ctx.resolve.mockResolvedValue({ ...ADMIN_CTX, departmentId: null });
      prisma.employeeGrant.findMany.mockResolvedValueOnce([
        grantRow("i-direct"),
      ]);

      const rows = await service.myEmployees("u1");

      // 只查了一次（直接授权），没查部门
      expect(prisma.employeeGrant.findMany).toHaveBeenCalledTimes(1);
      expect(rows).toHaveLength(1);
    });

    it("只查 ACTIVE 雇佣关系且过滤未过期授权", async () => {
      await service.myEmployees("u1");

      const where = prisma.employeeGrant.findMany.mock.calls[0][0].where;
      expect(where.subscription).toMatchObject({
        enterpriseId: "ent-a",
        status: "ACTIVE",
      });
      // expiresAt 为空或未到期
      expect(where.OR).toEqual([
        { expiresAt: null },
        { expiresAt: { gt: expect.any(Date) } },
      ]);
    });

    it("按当前成员 id 查直接授权，而非 userId", async () => {
      await service.myEmployees("u1");
      const where = prisma.employeeGrant.findMany.mock.calls[0][0].where;
      expect(where.memberId).toBe("m-admin");
    });

    it("标注 packageAvailable —— 前端据此决定下载按钮是否可点", async () => {
      prisma.employeeGrant.findMany
        .mockResolvedValueOnce([grantRow("i-has-pkg")])
        .mockResolvedValueOnce([]);
      // 模板 t1 有包
      packages.employeeIdsWithPackage.mockResolvedValue(new Set(["t1"]));

      const rows = await service.myEmployees("u1");

      expect(rows[0].packageAvailable).toBe(true);
      // 只按去重后的模板 id 查一次，不是每行查一次
      expect(packages.employeeIdsWithPackage).toHaveBeenCalledWith(["t1"]);
    });

    it("运营未上传包时 packageAvailable 为 false，而非 undefined", async () => {
      prisma.employeeGrant.findMany
        .mockResolvedValueOnce([grantRow("i-no-pkg")])
        .mockResolvedValueOnce([]);
      packages.employeeIdsWithPackage.mockResolvedValue(new Set());

      const rows = await service.myEmployees("u1");

      expect(rows[0].packageAvailable).toBe(false);
    });
  });

  describe("create", () => {
    beforeEach(() => {
      prisma.subscription.findUnique.mockResolvedValue({
        id: "i1",
        enterpriseId: "ent-a",
        status: "ACTIVE",
      });
      prisma.employeeGrant.create.mockResolvedValue({
        id: "g1",
        expiresAt: null,
        createdAt: new Date(),
        department: { id: "d-1", name: "客服部" },
        member: null,
      });
    });

    it("授权给部门", async () => {
      prisma.department.findUnique.mockResolvedValue({
        id: "d-1",
        enterpriseId: "ent-a",
      });

      const r = await service.create("u1", "i1", { departmentId: "d-1" });

      expect(r.department).toEqual({ id: "d-1", name: "客服部" });
      expect(prisma.employeeGrant.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            subscriptionId: "i1",
            departmentId: "d-1",
            memberId: null,
          }),
        }),
      );
    });

    it("已失效的雇佣关系不可授权", async () => {
      prisma.subscription.findUnique.mockResolvedValue({
        id: "i1",
        enterpriseId: "ent-a",
        status: "EXPIRED",
      });

      await expect(
        service.create("u1", "i1", { departmentId: "d-1" }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.employeeGrant.create).not.toHaveBeenCalled();
    });

    it("雇佣关系失效时先于授权对象校验 —— 主体失效就不必再查部门", async () => {
      prisma.subscription.findUnique.mockResolvedValue({
        id: "i1",
        enterpriseId: "ent-a",
        status: "EXPIRED",
      });

      await expect(
        service.create("u1", "i1", { departmentId: "d-not-exist" }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.department.findUnique).not.toHaveBeenCalled();
    });

    it("跨企业部门返回 404", async () => {
      prisma.department.findUnique.mockResolvedValue({
        id: "d-x",
        enterpriseId: "ent-b",
      });

      await expect(
        service.create("u1", "i1", { departmentId: "d-x" }),
      ).rejects.toThrow(NotFoundException);
    });

    it("跨企业成员返回 404", async () => {
      prisma.enterpriseMember.findUnique.mockResolvedValue({
        id: "m-x",
        enterpriseId: "ent-b",
      });

      await expect(
        service.create("u1", "i1", { memberId: "m-x" }),
      ).rejects.toThrow(NotFoundException);
    });

    it("重复授权返回 409", async () => {
      prisma.department.findUnique.mockResolvedValue({
        id: "d-1",
        enterpriseId: "ent-a",
      });
      prisma.employeeGrant.create.mockRejectedValue({ code: "P2002" });

      await expect(
        service.create("u1", "i1", { departmentId: "d-1" }),
      ).rejects.toThrow(ConflictException);
    });

    it("非 P2002 的错误原样抛出，不误报为重复", async () => {
      prisma.department.findUnique.mockResolvedValue({
        id: "d-1",
        enterpriseId: "ent-a",
      });
      prisma.employeeGrant.create.mockRejectedValue(new Error("连接中断"));

      await expect(
        service.create("u1", "i1", { departmentId: "d-1" }),
      ).rejects.toThrow("连接中断");
    });

    it("非企业管理员被拦截", async () => {
      ctx.assertEnterpriseAdmin.mockImplementation(() => {
        throw new ForbiddenException();
      });

      await expect(
        service.create("u1", "i1", { departmentId: "d-1" }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe("remove", () => {
    it("收回本企业的授权", async () => {
      prisma.employeeGrant.findUnique.mockResolvedValue({
        id: "g1",
        subscription: { enterpriseId: "ent-a" },
      });
      prisma.employeeGrant.delete.mockResolvedValue({ id: "g1" });

      const r = await service.remove("u1", "g1");

      expect(r).toEqual({ id: "g1" });
      expect(prisma.employeeGrant.delete).toHaveBeenCalledWith({
        where: { id: "g1" },
      });
    });

    it("跨企业授权返回 404 且不删除", async () => {
      prisma.employeeGrant.findUnique.mockResolvedValue({
        id: "g9",
        subscription: { enterpriseId: "ent-b" },
      });

      await expect(service.remove("u1", "g9")).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.employeeGrant.delete).not.toHaveBeenCalled();
    });
  });

  describe("listForSubscription", () => {
    it("过期记录标 expired=true 但仍返回", async () => {
      prisma.subscription.findUnique.mockResolvedValue({
        id: "i1",
        enterpriseId: "ent-a",
        status: "ACTIVE",
      });
      const past = new Date(Date.now() - 86400_000);
      prisma.employeeGrant.findMany.mockResolvedValue([
        {
          id: "g-expired",
          expiresAt: past,
          createdAt: new Date(),
          department: null,
          member: {
            id: "m-1",
            user: { name: "小王", email: "w@acme.local" },
          },
        },
        {
          id: "g-forever",
          expiresAt: null,
          createdAt: new Date(),
          department: { id: "d-1", name: "客服部" },
          member: null,
        },
      ]);

      const rows = await service.listForSubscription("u1", "i1");

      expect(rows).toHaveLength(2);
      expect(rows.find((r) => r.id === "g-expired")?.expired).toBe(true);
      expect(rows.find((r) => r.id === "g-forever")?.expired).toBe(false);
      // 成员信息扁平化，不暴露嵌套的 user 对象
      expect(rows.find((r) => r.id === "g-expired")?.member).toEqual({
        id: "m-1",
        name: "小王",
        email: "w@acme.local",
      });
    });
  });
});
