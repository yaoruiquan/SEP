import { BadRequestException } from '@nestjs/common';
import { OneTimeTokenService } from './one-time-token.service';

function makePrisma() {
  const record = {
    id: 'token-1', userId: 'user-1', type: 'PASSWORD_RESET',
    tokenHash: '', metadata: null, expiresAt: new Date(Date.now() + 60_000), consumedAt: null,
  };
  const prisma: any = {
    authOneTimeToken: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn().mockResolvedValue(record),
    },
    $transaction: jest.fn(async (fn: any) => typeof fn === 'function' ? fn(prisma) : fn),
  };
  return { prisma, record };
}

describe('OneTimeTokenService', () => {
  it('只保存 hash，消费后只能成功一次', async () => {
    const { prisma } = makePrisma();
    const service = new OneTimeTokenService(prisma);
    const issued = await service.issue({ userId: 'user-1', type: 'PASSWORD_RESET' });
    expect(issued.token).toHaveLength(43);
    expect(prisma.authOneTimeToken.create.mock.calls[0][0].data.tokenHash).not.toBe(issued.token);

    prisma.authOneTimeToken.updateMany.mockResolvedValueOnce({ count: 1 });
    await expect(service.consume('raw-token', 'PASSWORD_RESET')).resolves.toMatchObject({ userId: 'user-1' });
    prisma.authOneTimeToken.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.consume('raw-token', 'PASSWORD_RESET')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('用途不匹配时统一拒绝', async () => {
    const { prisma } = makePrisma();
    const service = new OneTimeTokenService(prisma);
    await expect(service.consume('raw-token', 'EMAIL_VERIFICATION')).rejects.toBeInstanceOf(BadRequestException);
  });
});
