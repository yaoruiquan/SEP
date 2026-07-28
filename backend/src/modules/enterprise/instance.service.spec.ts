import { Test } from "@nestjs/testing";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { InstanceService } from "./instance.service";
import { EnterpriseContextService } from "./enterprise-context.service";
import { PrismaService } from "../../prisma/prisma.service";

const ADMIN_CTX = {
  enterpriseId: "ent-a",
  memberId: "m-admin",
  role: "ENTERPRISE_ADMIN" as const,
  departmentId: null,
};

describe("InstanceService", () => {
  let service: InstanceService;
  let prisma: any;
  let ctx: any;

  beforeEach(async () => {
    prisma = {
      employeeInstance: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      subscription: { findUnique: jest.fn() },
      digitalEmployee: { findUnique: jest.fn() },
      department: { findUnique: jest.fn() },
    };
    ctx = {
      resolve: jest.fn().mockResolvedValue(ADMIN_CTX),
      assertEnterpriseAdmin: jest.fn(),
    };

    const mod = await Test.createTestingModule({
      providers: [
        InstanceService,
        { provide: PrismaService, useValue: prisma },
        { provide: EnterpriseContextService, useValue: ctx },
      ],
    }).compile();

    service = mod.get(InstanceService);
  });

  describe("list", () => {
    it("模板版本与实例锁定版本不同时给出升级提示", async () => {
      prisma.employeeInstance.findMany.mockResolvedValue([
        {
          id: "i1",
          name: "客服小美",
          status: "ACTIVE",
          templateVersion: "1.0.0",
          config: null,
          createdAt: new Date(),
          template: { id: "t1", name: "客服", avatar: null, version: "1.1.0" },
          department: null,
        },
        {
          id: "i2",
          name: "客服小帅",
          status: "ACTIVE",
          templateVersion: "1.1.0",
          config: null,
          createdAt: new Date(),
          template: { id: "t1", name: "客服", avatar: null, version: "1.1.0" },
          department: null,
        },
      ]);

      const rows = await service.list("u1");

      expect(rows[0].upgradeAvailable).toBe(true);
      expect(rows[0].latestVersion).toBe("1.1.0");
      expect(rows[1].upgradeAvailable).toBe(false);
    });

    it("只查本企业的实例", async () => {
      prisma.employeeInstance.findMany.mockResolvedValue([]);
      await service.list("u1");
      expect(prisma.employeeInstance.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { enterpriseId: "ent-a" } }),
      );
    });

    it("调用者不属于任何企业时透传 ForbiddenException", async () => {
      ctx.resolve.mockRejectedValue(new ForbiddenException());
      await expect(service.list("u-nobody")).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe("create", () => {
    const dto = { templateId: "t1", name: "客服小美" };

    it("未订阅该模板时拒绝", async () => {
      prisma.subscription.findUnique.mockResolvedValue(null);
      await expect(service.create("u1", dto)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.employeeInstance.create).not.toHaveBeenCalled();
    });

    it("订阅存在但已过期时拒绝", async () => {
      prisma.subscription.findUnique.mockResolvedValue({ status: "EXPIRED" });
      await expect(service.create("u1", dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("创建时锁定模板当前版本", async () => {
      prisma.subscription.findUnique.mockResolvedValue({ status: "ACTIVE" });
      prisma.digitalEmployee.findUnique.mockResolvedValue({
        id: "t1",
        version: "2.3.0",
        status: "PUBLISHED",
      });
      prisma.employeeInstance.create.mockResolvedValue({ id: "i1" });

      await service.create("u1", dto);

      expect(prisma.employeeInstance.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            templateVersion: "2.3.0",
            enterpriseId: "ent-a",
            status: "PENDING_ACTIVATION",
          }),
        }),
      );
    });

    it("跨企业部门 id 返回 404", async () => {
      prisma.subscription.findUnique.mockResolvedValue({ status: "ACTIVE" });
      prisma.digitalEmployee.findUnique.mockResolvedValue({
        id: "t1",
        version: "1.0.0",
        status: "PUBLISHED",
      });
      prisma.department.findUnique.mockResolvedValue({
        id: "d-other",
        enterpriseId: "ent-b",
      });

      await expect(
        service.create("u1", { ...dto, departmentId: "d-other" }),
      ).rejects.toThrow(NotFoundException);
    });

    it("非企业管理员被拦截", async () => {
      ctx.assertEnterpriseAdmin.mockImplementation(() => {
        throw new ForbiddenException();
      });
      await expect(service.create("u1", dto)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.subscription.findUnique).not.toHaveBeenCalled();
    });

    it("同一模板允许开多个实例（不做唯一性检查）", async () => {
      prisma.subscription.findUnique.mockResolvedValue({ status: "ACTIVE" });
      prisma.digitalEmployee.findUnique.mockResolvedValue({
        id: "t1",
        version: "1.0.0",
        status: "PUBLISHED",
      });
      prisma.employeeInstance.create.mockResolvedValue({ id: "i2" });

      await service.create("u1", dto);
      await service.create("u1", { ...dto, name: "客服小帅" });

      expect(prisma.employeeInstance.create).toHaveBeenCalledTimes(2);
    });
  });

  describe("changeStatus", () => {
    const mockInstance = (status: string) =>
      prisma.employeeInstance.findUnique.mockResolvedValue({
        id: "i1",
        enterpriseId: "ent-a",
        status,
        templateId: "t1",
        templateVersion: "1.0.0",
      });

    it("PENDING_ACTIVATION → ACTIVE 允许", async () => {
      mockInstance("PENDING_ACTIVATION");
      prisma.employeeInstance.update.mockResolvedValue({
        id: "i1",
        status: "ACTIVE",
      });
      const r = await service.changeStatus("u1", "i1", "ACTIVE");
      expect(r.changed).toBe(true);
    });

    it("ACTIVE → SUSPENDED 允许，且不动授权记录", async () => {
      mockInstance("ACTIVE");
      prisma.employeeInstance.update.mockResolvedValue({
        id: "i1",
        status: "SUSPENDED",
      });
      await service.changeStatus("u1", "i1", "SUSPENDED");
      expect(prisma.employeeInstance.update).toHaveBeenCalledWith({
        where: { id: "i1" },
        data: { status: "SUSPENDED" },
        select: { id: true, status: true },
      });
    });

    it("REVOKED 是终态，不可复活", async () => {
      mockInstance("REVOKED");
      await expect(
        service.changeStatus("u1", "i1", "ACTIVE"),
      ).rejects.toThrow(ConflictException);
    });

    it("PENDING_ACTIVATION → SUSPENDED 非法", async () => {
      mockInstance("PENDING_ACTIVATION");
      await expect(
        service.changeStatus("u1", "i1", "SUSPENDED"),
      ).rejects.toThrow(ConflictException);
    });

    it("状态未变时幂等返回，不写库", async () => {
      mockInstance("ACTIVE");
      const r = await service.changeStatus("u1", "i1", "ACTIVE");
      expect(r.changed).toBe(false);
      expect(prisma.employeeInstance.update).not.toHaveBeenCalled();
    });

    it("跨企业实例返回 404 而非 403", async () => {
      prisma.employeeInstance.findUnique.mockResolvedValue({
        id: "i9",
        enterpriseId: "ent-b",
        status: "ACTIVE",
        templateId: "t1",
        templateVersion: "1.0.0",
      });
      await expect(
        service.changeStatus("u1", "i9", "SUSPENDED"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("upgrade", () => {
    beforeEach(() => {
      prisma.employeeInstance.findUnique.mockResolvedValue({
        id: "i1",
        enterpriseId: "ent-a",
        status: "ACTIVE",
        templateId: "t1",
        templateVersion: "1.0.0",
      });
    });

    it("升级到最新版并要求复核配置", async () => {
      prisma.digitalEmployee.findUnique.mockResolvedValue({ version: "1.2.0" });
      prisma.employeeInstance.update.mockResolvedValue({
        id: "i1",
        templateVersion: "1.2.0",
      });

      const r = await service.upgrade("u1", "i1");

      expect(r).toMatchObject({
        from: "1.0.0",
        to: "1.2.0",
        configReviewRequired: true,
      });
    });

    it("不自动迁移 config", async () => {
      prisma.digitalEmployee.findUnique.mockResolvedValue({ version: "1.2.0" });
      prisma.employeeInstance.update.mockResolvedValue({ id: "i1" });

      await service.upgrade("u1", "i1");

      const data = prisma.employeeInstance.update.mock.calls[0][0].data;
      expect(data).toEqual({ templateVersion: "1.2.0" });
    });

    it("已是最新版时拒绝", async () => {
      prisma.digitalEmployee.findUnique.mockResolvedValue({ version: "1.0.0" });
      await expect(service.upgrade("u1", "i1")).rejects.toThrow(
        ConflictException,
      );
    });

    it("已回收的实例不可升级", async () => {
      prisma.employeeInstance.findUnique.mockResolvedValue({
        id: "i1",
        enterpriseId: "ent-a",
        status: "REVOKED",
        templateId: "t1",
        templateVersion: "1.0.0",
      });
      await expect(service.upgrade("u1", "i1")).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe("update", () => {
    beforeEach(() => {
      prisma.employeeInstance.findUnique.mockResolvedValue({
        id: "i1",
        enterpriseId: "ent-a",
        status: "ACTIVE",
        templateId: "t1",
        templateVersion: "1.0.0",
      });
    });

    it("departmentId 传 null 可清空部门归属", async () => {
      prisma.employeeInstance.update.mockResolvedValue({ id: "i1" });
      await service.update("u1", "i1", { departmentId: null });
      const data = prisma.employeeInstance.update.mock.calls[0][0].data;
      expect(data).toEqual({ departmentId: null });
      // null 不触发部门校验
      expect(prisma.department.findUnique).not.toHaveBeenCalled();
    });

    it("未传的字段不出现在 update data 里", async () => {
      prisma.employeeInstance.update.mockResolvedValue({ id: "i1" });
      await service.update("u1", "i1", { name: "新名字" });
      const data = prisma.employeeInstance.update.mock.calls[0][0].data;
      expect(data).toEqual({ name: "新名字" });
    });

    it("已回收的实例不可修改", async () => {
      prisma.employeeInstance.findUnique.mockResolvedValue({
        id: "i1",
        enterpriseId: "ent-a",
        status: "REVOKED",
        templateId: "t1",
        templateVersion: "1.0.0",
      });
      await expect(
        service.update("u1", "i1", { name: "x" }),
      ).rejects.toThrow(ConflictException);
    });
  });
});
