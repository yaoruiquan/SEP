import { CapabilityService } from './capability.service';
import { SkillVersionService } from '../skill-version/skill-version.service';

/** 通过真实解析器核对传入适配器的正文及执行归因，不能只测试选版记录。 */
describe('技能实际执行采用成员版本', () => {
  const capability = { id: 'cap-1', type: 'SKILL', agentConfig: { platform: 'OPENCODE', skillName: 'skill' } };
  const enterprise = { id: 'enterprise-v', capabilityId: 'cap-1', scope: 'ENTERPRISE', enterpriseId: 'ent-1', status: 'ENTERPRISE_APPROVED', content: '企业默认正文' };
  const personal = { id: 'personal-v', capabilityId: 'cap-1', scope: 'PERSONAL', enterpriseId: 'ent-1', ownerId: 'user-1', status: 'PERSONAL_ACTIVE', content: '本人副本正文' };
  const platform = { id: 'platform-v', capabilityId: 'cap-1', scope: 'PLATFORM', enterpriseId: null, ownerId: null, status: 'PLATFORM_APPROVED', content: '我选的旧平台正文' };
  function build() {
    const preferences = new Map<string, { versionId: string | null; version: typeof platform | null }>();
    const prisma = {
      capability: { findUnique: jest.fn().mockResolvedValue(capability) },
      subscription: { findUnique: jest.fn().mockResolvedValue({ enterpriseId: 'ent-1', employee: { bindings: [] } }) },
      memberSkillVersionSelection: { findFirst: jest.fn(async ({ where }) => preferences.get(`${where.member.userId}:${where.subscriptionId}`) ?? null) },
      skillVersion: { findFirst: jest.fn(async ({ where }) => where.ownerId === 'user-1' ? personal : null) },
      subscriptionSkillVersion: { findUnique: jest.fn().mockResolvedValue({ version: enterprise }) },
    };
    const versions = new SkillVersionService(prisma as never, {} as never);
    const execute = jest.fn().mockResolvedValue({ success: true, output: 'result' });
    const factory = { create: jest.fn().mockReturnValue({ execute }) };
    return { preferences, factory, prisma, execute, service: new CapabilityService(prisma as never, factory as never, versions) };
  }
  it('同订阅不同成员、同成员不同订阅各自独立，正文与归因一致', async () => {
    const { service, preferences, factory, execute } = build();
    preferences.set('user-1:sub-a', { versionId: platform.id, version: platform });
    preferences.set('user-1:sub-b', { versionId: null, version: null });
    for (const [userId, subscriptionId, expected] of [
      ['user-1', 'sub-a', platform], ['user-1', 'sub-b', enterprise], ['user-2', 'sub-a', enterprise],
    ] as const) {
      const input = { userMessage: '执行技能', userId, sessionId: 'session-1' };
      const result = await service.execute('cap-1', input, { subscriptionId, userId });
      expect(factory.create).toHaveBeenLastCalledWith(expect.objectContaining({ skillContent: expected.content, skillVersionId: expected.id }));
      expect(result.skillVersionId).toBe(expected.id);
      expect(execute).toHaveBeenLastCalledWith(input);
    }
  });
  it('企业默认后来发布新版不覆盖个人钉住的版本', async () => {
    const { service, preferences, prisma, factory } = build();
    preferences.set('user-1:sub-a', { versionId: platform.id, version: platform });
    prisma.subscriptionSkillVersion.findUnique.mockResolvedValue({ version: { ...enterprise, id: 'enterprise-new', content: '新默认' } });
    await service.execute('cap-1', { userMessage: '执行', sessionId: 'session' }, { subscriptionId: 'sub-a', userId: 'user-1' });
    expect(factory.create).toHaveBeenLastCalledWith(expect.objectContaining({ skillContent: platform.content, skillVersionId: platform.id }));
  });
  it('显式跟随企业跳过已保存副本，而无偏好的存量用户仍使用副本', async () => {
    const { service, preferences, factory } = build();
    const input = { userMessage: '执行', sessionId: 'session' };
    await service.execute('cap-1', input, { subscriptionId: 'sub-a', userId: 'user-1' });
    expect(factory.create).toHaveBeenLastCalledWith(expect.objectContaining({ skillVersionId: personal.id }));
    preferences.set('user-1:sub-a', { versionId: null, version: null });
    await service.execute('cap-1', input, { subscriptionId: 'sub-a', userId: 'user-1' });
    expect(factory.create).toHaveBeenLastCalledWith(expect.objectContaining({ skillVersionId: enterprise.id }));
  });
});
