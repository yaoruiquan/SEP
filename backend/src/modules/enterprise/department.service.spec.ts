/**
 * 部门树服务测试。
 *
 * 重点覆盖两类**自引用外键挡不住**的问题：
 *   ① 环：把部门移到自己的子孙下 —— 成环后这些节点从树里彻底消失
 *      （既非根、祖先链又不可达），前端看不到也删不掉，只能改库修复
 *   ② 跨企业挂载：把本企业部门挂到别家企业的父节点下
 */
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { DepartmentService } from './department.service';

const ACME = {
  enterpriseId: 'ent-acme',
  memberId: 'mem-boss',
  role: 'ENTERPRISE_ADMIN' as const,
  departmentId: null,
};

describe('DepartmentService', () => {
  let prisma: any;
  let ctxSvc: any;
  let svc: DepartmentService;

  beforeEach(() => {
    prisma = {
      department: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn((a: any) => Promise.resolve({ id: 'dept-new', ...a.data })),
        update: jest.fn((a: any) => Promise.resolve({ id: a.where.id, ...a.data })),
        delete: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(0),
      },
      enterpriseMember: { count: jest.fn().mockResolvedValue(0) },
    };
    ctxSvc = {
      resolve: jest.fn().mockResolvedValue(ACME),
      assertEnterpriseAdmin: jest.fn(),
    };
    svc = new DepartmentService(prisma, ctxSvc);
  });

  describe('tree', () => {
    it('把扁平列表组装成树，并带上成员数', async () => {
      prisma.department.findMany.mockResolvedValue([
        { id: 'tech', name: '技术部', parentId: null, sortOrder: 0, _count: { members: 2 } },
        { id: 'fe', name: '前端组', parentId: 'tech', sortOrder: 0, _count: { members: 1 } },
        { id: 'ops', name: '运营部', parentId: null, sortOrder: 1, _count: { members: 0 } },
      ]);

      const tree = await svc.tree('u1');

      expect(tree).toHaveLength(2); // 两个顶级部门
      const tech = tree.find((n) => n.id === 'tech')!;
      expect(tech.memberCount).toBe(2);
      expect(tech.children).toHaveLength(1);
      expect(tech.children[0].id).toBe('fe');
    });

    it('查询必须带 enterpriseId 过滤', async () => {
      prisma.department.findMany.mockResolvedValue([]);
      await svc.tree('u1');
      expect(prisma.department.findMany.mock.calls[0][0].where).toEqual({
        enterpriseId: 'ent-acme',
      });
    });
  });

  describe('create', () => {
    it('enterpriseId 取自上下文而非入参', async () => {
      await svc.create('u1', { name: '新部门' } as never);
      expect(prisma.department.create.mock.calls[0][0].data.enterpriseId).toBe(
        'ent-acme',
      );
    });

    it('❗父部门属于别家企业时拒绝（防跨企业挂载）', async () => {
      prisma.department.findUnique.mockResolvedValue({
        id: 'dept-globex',
        enterpriseId: 'ent-globex',
      });

      await expect(
        svc.create('u1', { name: 'X', parentId: 'dept-globex' } as never),
      ).rejects.toThrow(NotFoundException);
    });

    it('非管理员不能创建', async () => {
      ctxSvc.assertEnterpriseAdmin.mockImplementation(() => {
        throw new Error('forbidden');
      });
      await expect(svc.create('u1', { name: 'X' } as never)).rejects.toThrow();
    });
  });

  describe('update —— 环检测', () => {
    it('❗不能把部门设为自己的父部门', async () => {
      prisma.department.findUnique.mockResolvedValue({
        id: 'tech',
        enterpriseId: 'ent-acme',
      });

      await expect(
        svc.update('u1', 'tech', { parentId: 'tech' } as never),
      ).rejects.toThrow(BadRequestException);
    });

    it('❗不能把部门移到自己的子部门之下', async () => {
      // 结构：tech → fe → fe-sub，尝试把 tech 移到 fe-sub 下
      prisma.department.findUnique.mockImplementation(({ where, select }: any) => {
        const rows: Record<string, any> = {
          tech: { id: 'tech', enterpriseId: 'ent-acme', parentId: null },
          fe: { id: 'fe', enterpriseId: 'ent-acme', parentId: 'tech' },
          'fe-sub': { id: 'fe-sub', enterpriseId: 'ent-acme', parentId: 'fe' },
        };
        const row = rows[where.id];
        if (!row) return Promise.resolve(null);
        // 模拟不同 select 的返回
        if (select?.parentId !== undefined && select?.enterpriseId === undefined) {
          return Promise.resolve({ parentId: row.parentId });
        }
        return Promise.resolve(row);
      });

      await expect(
        svc.update('u1', 'tech', { parentId: 'fe-sub' } as never),
      ).rejects.toThrow(/不能将部门移动到其子部门之下/);
    });

    it('移到无关的同企业部门下是允许的', async () => {
      prisma.department.findUnique.mockImplementation(({ where, select }: any) => {
        const rows: Record<string, any> = {
          fe: { id: 'fe', enterpriseId: 'ent-acme', parentId: 'tech' },
          ops: { id: 'ops', enterpriseId: 'ent-acme', parentId: null },
        };
        const row = rows[where.id];
        if (!row) return Promise.resolve(null);
        if (select?.parentId !== undefined && select?.enterpriseId === undefined) {
          return Promise.resolve({ parentId: row.parentId });
        }
        return Promise.resolve(row);
      });

      await expect(
        svc.update('u1', 'fe', { parentId: 'ops' } as never),
      ).resolves.toBeDefined();
    });

    it('别家企业的部门不可更新', async () => {
      prisma.department.findUnique.mockResolvedValue({
        id: 'dept-globex',
        enterpriseId: 'ent-globex',
      });
      await expect(
        svc.update('u1', 'dept-globex', { name: 'X' } as never),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    beforeEach(() => {
      prisma.department.findUnique.mockResolvedValue({
        id: 'tech',
        enterpriseId: 'ent-acme',
      });
    });

    it('有子部门时拒绝删除，而非级联', async () => {
      prisma.department.count.mockResolvedValue(2);
      await expect(svc.remove('u1', 'tech')).rejects.toThrow(ConflictException);
      expect(prisma.department.delete).not.toHaveBeenCalled();
    });

    it('有成员时拒绝删除', async () => {
      prisma.department.count.mockResolvedValue(0);
      prisma.enterpriseMember.count.mockResolvedValue(3);
      await expect(svc.remove('u1', 'tech')).rejects.toThrow(ConflictException);
      expect(prisma.department.delete).not.toHaveBeenCalled();
    });

    it('空部门可以删除', async () => {
      prisma.department.count.mockResolvedValue(0);
      prisma.enterpriseMember.count.mockResolvedValue(0);
      await expect(svc.remove('u1', 'tech')).resolves.toEqual({
        id: 'tech',
        deleted: true,
      });
    });
  });
});
