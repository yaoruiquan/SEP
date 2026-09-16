import { ForbiddenException } from '@nestjs/common';
import { ConversationService } from './conversation.service';
import { withEmployeeAvatar } from '../../common/employee-avatar';

describe('conversation employee avatars', () => {
  const employee = { id: 'employee-1', name: 'Engineer', avatar: '/assets/employees/silicon/frontend-engineer.webp' };
  const session = { id: 'session-1', userId: 'user-1', employee, messages: [] };
  let service: ConversationService;
  let prisma: any;
  beforeEach(() => {
    prisma = {
      digitalEmployee: { findUnique: jest.fn().mockResolvedValue(employee) },
      subscription: { findUnique: jest.fn().mockResolvedValue({ id: 'sub-1' }) },
      conversationSession: {
        create: jest.fn().mockResolvedValue(session),
        findMany: jest.fn().mockResolvedValue([session]),
        findUnique: jest.fn().mockResolvedValue(session),
      },
    };
    service = new ConversationService(
      prisma,
      { assertActiveSubscription: jest.fn() } as any,
      {} as any,
      { get: jest.fn().mockResolvedValue({ defaultChatModel: 'model-1' }) } as any,
      {} as any,
      { checkBalanceBeforeConversation: jest.fn().mockResolvedValue({ allowed: true }) } as any,
      { resolve: jest.fn().mockResolvedValue({ enterpriseId: 'ent-1' }) } as any,
    );
  });

  it('returns the same platform image in create, list and detail', async () => {
    const created = await service.create('user-1', { employeeId: employee.id } as any);
    const [listed] = await service.findAll('user-1');
    const detail = await service.findOne(session.id, 'user-1');
    for (const result of [created, listed, detail]) {
      expect(result.employee).toEqual(withEmployeeAvatar(employee));
    }
    expect(employee.avatar).toBe('/assets/employees/silicon/frontend-engineer.webp');
  });

  it('does not return another user conversation or its employee metadata', async () => {
    await expect(service.findOne(session.id, 'user-2')).rejects.toThrow(ForbiddenException);
  });
});
