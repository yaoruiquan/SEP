import { Test } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { KnowledgeService } from './knowledge.service';
import { EnterpriseContextService } from '../enterprise/enterprise-context.service';
import { PrismaService } from '../../prisma/prisma.service';
import { VectorService } from './vector.service';

const ADMIN_CTX = {
  enterpriseId: 'ent-a',
  memberId: 'm-admin',
  role: 'ENTERPRISE_ADMIN' as const,
  departmentId: 'd-1',
};

describe('KnowledgeService', () => {
  let service: KnowledgeService;
  let prisma: any;
  let ctx: any;

  beforeEach(async () => {
    prisma = {
      subscription: { findUnique: jest.fn() },
      knowledgeGrant: { findMany: jest.fn().mockResolvedValue([]) },
      knowledgeBase: { findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn() },
    };
    ctx = { resolve: jest.fn().mockResolvedValue(ADMIN_CTX) };

    const mod = await Test.createTestingModule({
      providers: [
        KnowledgeService,
        { provide: PrismaService, useValue: prisma },
        { provide: EnterpriseContextService, useValue: ctx },
        { provide: VectorService, useValue: { invalidateCache: jest.fn() } },
      ],
    }).compile();

    service = mod.get(KnowledgeService);
  });

  describe('listGrantsBySubscription —— 按雇佣关系反查可读知识库', () => {
    it('本企业的雇佣关系：返回该关系上的知识库授权', async () => {
      prisma.subscription.findUnique.mockResolvedValue({
        enterpriseId: 'ent-a',
      });
      const rows = [
        { id: 'g1', knowledgeBase: { id: 'kb1', name: '产品手册' } },
      ];
      prisma.knowledgeGrant.findMany.mockResolvedValue(rows);

      await expect(service.listGrantsBySubscription('u1', 'sub-1')).resolves.toBe(
        rows,
      );
      expect(prisma.knowledgeGrant.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { subscriptionId: 'sub-1' } }),
      );
    });

    it('别家企业的雇佣关系：抛 Forbidden，不能返空数组糊过去', async () => {
      prisma.subscription.findUnique.mockResolvedValue({
        enterpriseId: 'ent-b',
      });

      await expect(
        service.listGrantsBySubscription('u1', 'sub-other'),
      ).rejects.toThrow(ForbiddenException);
      // 越权时绝不能落到查询 —— 否则改一行 where 就漏数据
      expect(prisma.knowledgeGrant.findMany).not.toHaveBeenCalled();
    });

    it('雇佣关系不存在：同样抛 Forbidden，不泄漏 id 是否存在', async () => {
      prisma.subscription.findUnique.mockResolvedValue(null);

      await expect(
        service.listGrantsBySubscription('u1', 'sub-ghost'),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.knowledgeGrant.findMany).not.toHaveBeenCalled();
    });
  });
});
