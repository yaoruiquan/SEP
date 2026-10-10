import { ForbiddenException } from '@nestjs/common';
import { SkillVersionService } from './skill-version.service';

describe('旧 Web 技能写入口停用', () => {
  it.each([
    ['createPersonalVersion', ['user-1', 'cap-1']],
    ['updatePersonalVersion', ['user-1', 'version-1', { content: '# Changed' }]],
    ['discardPersonalVersion', ['user-1', 'version-1']],
    ['createEnterpriseVersion', ['user-1', 'sub-1', { capabilityId: 'cap-1', parentVersionId: 'version-1' }]],
    ['updateEnterpriseVersion', ['user-1', 'version-1', { content: '# Changed' }]],
    ['publishEnterpriseVersion', ['user-1', 'version-1']],
    ['createEnterpriseVersionFromContent', ['user-1', 'ent-1', 'cap-1', '# Changed', 'Summary']],
    ['submitPlatformReview', ['user-1', 'version-1']],
  ])('%s 服务层拒绝且不写数据库', async (method, args) => {
    const prisma = { $transaction: jest.fn(), skillVersion: { create: jest.fn(), update: jest.fn() } };
    const context = { resolve: jest.fn() };
    const service = new SkillVersionService(prisma as never, context as never);
    await expect((service[method as keyof SkillVersionService] as (...args: unknown[]) => Promise<unknown>)(...(args as unknown[])))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.skillVersion.create).not.toHaveBeenCalled();
    expect(prisma.skillVersion.update).not.toHaveBeenCalled();
  });
});
