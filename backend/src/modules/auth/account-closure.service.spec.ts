import { BadRequestException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { AccountClosureService } from './account-closure.service';

const token = 'a'.repeat(43);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

function setup(withEnterprise = false) {
  const state = {
    user: { id: 'u1', email: 'member@example.com', status: 'ACTIVE', role: 'USER', name: 'Member', avatar: 'avatar' },
    enterprise: { id: 'e1', name: 'Acme', status: 'ACTIVE', closedAt: null as Date | null,
      members: withEnterprise ? [{ userId: 'u1', role: 'ENTERPRISE_ADMIN' }] : [] },
    requests: [] as any[],
  };
  const proof = { id: 'proof1', userId: 'u1', type: 'ACCOUNT_CLOSURE', tokenHash: digest(token),
    consumedAt: null as Date | null, metadata: { email: state.user.email, enterpriseIds: withEnterprise ? ['e1'] : [] },
    expiresAt: new Date(Date.now() + 60_000) };
  const count = () => jest.fn().mockResolvedValue(0);
  const deleted = () => ({ deleteMany: jest.fn().mockResolvedValue({ count: 1 }) });
  const updated = () => ({ updateMany: jest.fn().mockResolvedValue({ count: 1 }) });
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'u1' }]),
    user: {
      findUnique: jest.fn(async () => ({ ...state.user })),
      update: jest.fn(async ({ data }) => Object.assign(state.user, data)),
    },
    enterpriseMember: {
      findMany: jest.fn(async () => state.enterprise.members.some((item) => item.userId === 'u1') ? [{ enterpriseId: 'e1' }] : []),
      deleteMany: jest.fn(async () => { state.enterprise.members = []; return { count: 1 }; }),
    },
    enterprise: {
      findUnique: jest.fn(async () => structuredClone(state.enterprise)),
      update: jest.fn(async ({ data }) => Object.assign(state.enterprise, data)),
    },
    enterpriseWallet: { findMany: jest.fn().mockResolvedValue([{ balance: new Prisma.Decimal(0), frozenAmount: new Prisma.Decimal(0) }]) },
    memberAllowanceTopUp: { findMany: jest.fn().mockResolvedValue([]) }, subscriptionCredit: updated(),
    rechargeOrder: { count: count() }, enterpriseApiKey: updated(), subscription: updated(),
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    personalWallet: { findUnique: jest.fn().mockResolvedValue({ balance: new Prisma.Decimal(0) }) },
    personalRechargeOrder: { count: count() }, contributionRewardEvent: { count: count() },
    taskRun: { count: count() }, clientTaskMirror: { count: count() },
    gatewayExecution: { count: count() }, mediaRealBillingReservation: { count: count() }, order: { count: count() },
    accountClosureRequest: { create: jest.fn(async ({ data }) => {
      const request = { id: 'request1', ...data }; state.requests.push(request); return request;
    }) },
    authOneTimeToken: {
      findUnique: jest.fn(async () => ({ ...proof })),
      create: jest.fn().mockResolvedValue({}), ...updated(), ...deleted(),
    },
    authSession: updated(), authToken: deleted(), device: deleted(), authOAuthTransaction: deleted(),
    authCredential: deleted(), authIdentity: deleted(), notification: deleted(),
    authEvent: { create: jest.fn().mockResolvedValue({}), ...updated() },
    enterpriseInvitation: updated(),
  };
  const prisma = { ...tx, $transaction: jest.fn(async (fn) => {
    const snapshot = structuredClone(state);
    try { return await fn(tx); } catch (error) { Object.assign(state, snapshot); throw error; }
  }) };
  const mail = { sendAccountClosureVerification: jest.fn().mockResolvedValue(undefined) };
  const values: Record<string, string> = { WEB_BASE_URL: 'https://app.example.com', NODE_ENV: 'test' };
  const config = { get: (key: string) => values[key], getOrThrow: (key: string) => values[key] };
  const limits = { consume: jest.fn().mockResolvedValue({ allowed: true }) };
  const service = new AccountClosureService(prisma as any, mail as any, config as any, limits as any);
  const close = () => service.request('u1', { token, confirmation: '注销账号' });
  return { service, prisma, tx, state, proof, mail, limits, values, close };
}

describe('AccountClosureService immediate closure', () => {
  it('allows an account without an enterprise', async () => {
    const s = setup();
    await expect(s.service.eligibility('u1')).resolves.toEqual({ eligible: true, enterprisesToClose: [], blockers: [] });
  });

  it('allows only the last enterprise member with admin role and locks user before enterprise', async () => {
    const s = setup(true);
    await expect(s.service.eligibility('u1')).resolves.toEqual({
      eligible: true, enterprisesToClose: [{ id: 'e1', name: 'Acme' }], blockers: [],
    });
    expect(s.tx.$queryRaw.mock.calls[0][0].join('')).toContain('FROM users');
    expect(s.tx.$queryRaw.mock.calls[1][0].join('')).toContain('FROM enterprises');
  });

  it('blocks a multi-member enterprise without changing any data', async () => {
    const s = setup(true); s.state.enterprise.members.push({ userId: 'u2', role: 'MEMBER' });
    await expect(s.service.eligibility('u1')).resolves.toMatchObject({ eligible: false, blockers: [{ code: 'ENTERPRISE_MEMBERSHIP' }] });
    await expect(s.close()).rejects.toBeInstanceOf(ConflictException);
    expect(s.tx.enterprise.update).not.toHaveBeenCalled();
    expect(s.tx.accountClosureRequest.create).not.toHaveBeenCalled();
  });

  it('blocks a sole non-admin member and already closed enterprise', async () => {
    const s = setup(true); s.state.enterprise.members[0].role = 'MEMBER';
    await expect(s.service.eligibility('u1')).resolves.toMatchObject({ blockers: [{ code: 'ENTERPRISE_ADMIN_REQUIRED' }] });
    s.state.enterprise.status = 'CLOSED';
    await expect(s.service.eligibility('u1')).resolves.toMatchObject({ blockers: [{ code: 'ENTERPRISE_CLOSED' }] });
  });

  it.each(['balance', 'frozenAmount'])('blocks nonzero enterprise %s', async (field) => {
    const s = setup(true);
    s.tx.enterpriseWallet.findMany.mockResolvedValue([{ balance: new Prisma.Decimal(0), frozenAmount: new Prisma.Decimal(0), [field]: new Prisma.Decimal('0.01') }]);
    await expect(s.close()).rejects.toBeInstanceOf(ConflictException);
    expect(s.tx.enterprise.update).not.toHaveBeenCalled();
  });

  it('blocks pending enterprise recharge orders', async () => {
    const s = setup(true); s.tx.rechargeOrder.count.mockResolvedValue(1);
    await expect(s.service.eligibility('u1')).resolves.toMatchObject({ blockers: [{ code: 'ENTERPRISE_PENDING_PAYMENT' }] });
  });

  it('blocks remaining member funds even when the enterprise wallet is empty', async () => {
    const s = setup(true);
    s.tx.memberAllowanceTopUp.findMany.mockResolvedValue([{ amountCNY: new Prisma.Decimal('10'), consumedCNY: new Prisma.Decimal('9.99') }]);
    await expect(s.service.eligibility('u1')).resolves.toMatchObject({ blockers: [{ code: 'ENTERPRISE_MEMBER_BALANCE' }] });
    await expect(s.close()).rejects.toBeInstanceOf(ConflictException);
    expect(s.tx.enterprise.update).not.toHaveBeenCalled();
    s.tx.memberAllowanceTopUp.findMany.mockResolvedValue([{ amountCNY: new Prisma.Decimal('10'), consumedCNY: new Prisma.Decimal('10') }]);
    await expect(s.service.eligibility('u1')).resolves.toMatchObject({ eligible: true });
  });

  it.each(['taskRun', 'clientTaskMirror', 'gatewayExecution', 'mediaRealBillingReservation', 'order'] as const)(
    'checks %s across the whole closing enterprise', async (model) => {
      const s = setup(true); s.tx[model].count.mockResolvedValue(1);
      await expect(s.close()).rejects.toBeInstanceOf(ConflictException);
      expect(s.tx[model].count).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
        OR: expect.arrayContaining([{ enterpriseId: { in: ['e1'] } }]),
      }) }));
    },
  );

  it('returns actionable personal blockers and refuses platform admin closure', async () => {
    const s = setup(); s.state.user.role = 'ADMIN';
    s.tx.personalWallet.findUnique.mockResolvedValue({ balance: new Prisma.Decimal('0.01') });
    s.tx.personalRechargeOrder.count.mockResolvedValue(1);
    s.tx.contributionRewardEvent.count.mockResolvedValue(1);
    s.tx.mediaRealBillingReservation.count.mockResolvedValue(1);
    const result = await s.service.eligibility('u1');
    expect(result).toMatchObject({ eligible: false, blockers: expect.arrayContaining([
      expect.objectContaining({ code: 'PLATFORM_ADMIN' }), expect.objectContaining({ code: 'PERSONAL_BALANCE' }),
      expect.objectContaining({ code: 'PENDING_PAYMENT' }), expect.objectContaining({ code: 'UNSETTLED_REWARD' }),
      expect.objectContaining({ code: 'BILLING_RECONCILIATION' }),
    ]) });
  });

  it.each(['DISABLED', 'CLOSURE_PENDING', 'CLOSED'])('rejects %s before issuing or consuming proof', async (status) => {
    const s = setup(); s.state.user.status = status;
    await expect(s.service.requestVerification('u1')).rejects.toBeInstanceOf(ConflictException);
    await expect(s.close()).rejects.toBeInstanceOf(ConflictException);
    expect(s.mail.sendAccountClosureVerification).not.toHaveBeenCalled();
  });

  it('issues a hashed proof bound to email and enterprise scope without changing state', async () => {
    const s = setup(true);
    await s.service.requestVerification('u1');
    const input = s.mail.sendAccountClosureVerification.mock.calls[0][0];
    const url = new URL(input.verificationUrl);
    expect(url.pathname).toBe('/account-closure');
    expect(input.enterpriseNames).toEqual(['Acme']);
    expect(s.tx.authOneTimeToken.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      type: 'ACCOUNT_CLOSURE', tokenHash: digest(url.searchParams.get('token')!),
      metadata: { email: s.state.user.email, enterpriseIds: ['e1'] },
    }) });
    expect(s.tx.user.update).not.toHaveBeenCalled();
    expect(s.tx.enterprise.update).not.toHaveBeenCalled();
  });

  it('limits verification email per user', async () => {
    const s = setup(); s.limits.consume.mockResolvedValue({ allowed: false });
    await expect(s.service.requestVerification('u1')).rejects.toMatchObject({ status: 429 });
    expect(s.tx.authOneTimeToken.create).not.toHaveBeenCalled();
  });

  it('invalidates undelivered proof while preserving ACTIVE and allowing another email', async () => {
    const s = setup(); s.mail.sendAccountClosureVerification.mockRejectedValueOnce(new ServiceUnavailableException());
    await expect(s.service.requestVerification('u1')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(s.prisma.authOneTimeToken.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ tokenHash: expect.any(String) }) }));
    expect(s.state.user.status).toBe('ACTIVE');
    await expect(s.service.requestVerification('u1')).resolves.toMatchObject({ message: expect.any(String) });
  });

  it.each(['foreign-user', 'expired', 'consumed', 'wrong-purpose', 'email-changed', 'legacy-proof'])('rejects %s proof', async (kind) => {
    const s = setup();
    if (kind === 'foreign-user') s.proof.userId = 'u2';
    if (kind === 'expired') s.proof.expiresAt = new Date(Date.now() - 1);
    if (kind === 'consumed') s.proof.consumedAt = new Date();
    if (kind === 'wrong-purpose') s.proof.type = 'PASSWORD_RESET';
    if (kind === 'email-changed') s.state.user.email = 'changed@example.com';
    if (kind === 'legacy-proof') delete (s.proof.metadata as any).enterpriseIds;
    await expect(s.close()).rejects.toBeInstanceOf(BadRequestException);
    expect(s.tx.accountClosureRequest.create).not.toHaveBeenCalled();
  });

  it('requires fresh mail when enterprise scope changes after verification', async () => {
    const s = setup(true); s.proof.metadata.enterpriseIds = [];
    await expect(s.close()).rejects.toBeInstanceOf(ConflictException);
    expect(s.tx.enterprise.update).not.toHaveBeenCalled();
  });

  it('rejects proof that expires while waiting for enterprise inspection', async () => {
    const s = setup(true);
    s.tx.enterprise.findUnique.mockImplementationOnce(async () => {
      s.proof.expiresAt.setTime(Date.now() - 1);
      return structuredClone(s.state.enterprise);
    });
    await expect(s.close()).rejects.toBeInstanceOf(BadRequestException);
    expect(s.tx.accountClosureRequest.create).not.toHaveBeenCalled();
  });

  it('rechecks a newly joined member at final submission', async () => {
    const s = setup(true);
    await s.service.requestVerification('u1');
    s.state.enterprise.members.push({ userId: 'u2', role: 'MEMBER' });
    await expect(s.close()).rejects.toBeInstanceOf(ConflictException);
    expect(s.state.user.status).toBe('ACTIVE');
  });

  it('closes the enterprise and account immediately, terminates access, and preserves enterprise history', async () => {
    const s = setup(true);
    const result = await s.close();
    expect(result).toMatchObject({ status: 'CLOSED', closedAt: expect.any(String), closedEnterprises: [{ id: 'e1', name: 'Acme' }] });
    expect(s.state.enterprise).toMatchObject({ id: 'e1', status: 'CLOSED', closedAt: expect.any(Date), members: [] });
    expect(s.tx.enterpriseApiKey.updateMany).toHaveBeenCalledWith({ where: { enterpriseId: 'e1', revokedAt: null }, data: { revokedAt: expect.any(Date) } });
    expect(s.tx.subscription.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'TERMINATED', terminatedReason: 'enterprise_closed' }) }));
    expect(s.tx.subscriptionCredit.updateMany).toHaveBeenCalledWith({ where: { enterpriseId: 'e1', status: 'ACTIVE' }, data: { status: 'EXPIRED', version: { increment: 1 } } });
    expect(s.tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'ENTERPRISE_CLOSED' }) }));
    expect(s.state.requests).toEqual([expect.objectContaining({ status: 'COMPLETED', completedAt: expect.any(Date) })]);
    expect(s.state.user).toMatchObject({ id: 'u1', email: expect.stringMatching(/^closed\+u1\.[a-f0-9]{32}@account\.invalid$/), status: 'CLOSED', name: '已注销用户', avatar: null });
    expect(s.tx.enterpriseInvitation.updateMany).toHaveBeenCalledWith({ where: { email: { equals: 'member@example.com', mode: 'insensitive' }, status: 'PENDING' }, data: { status: 'REVOKED' } });
    for (const model of ['device', 'authCredential', 'authIdentity', 'authOneTimeToken', 'authOAuthTransaction', 'notification'] as const) {
      expect(s.tx[model].deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
    }
    expect(s.tx.authSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ revokedAt: expect.any(Date), ipAddress: null, userAgent: null }) }));
    await expect(s.close()).rejects.toBeInstanceOf(ConflictException);
    expect(s.tx.accountClosureRequest.create).toHaveBeenCalledTimes(1);
  });

  it('rolls enterprise and account back together when cleanup fails', async () => {
    const s = setup(true);
    s.tx.authIdentity.deleteMany.mockRejectedValueOnce(new Error('database error'));
    await expect(s.close()).rejects.toThrow('database error');
    expect(s.state.user).toMatchObject({ status: 'ACTIVE', email: 'member@example.com' });
    expect(s.state.enterprise).toMatchObject({ status: 'ACTIVE', closedAt: null, members: [{ userId: 'u1', role: 'ENTERPRISE_ADMIN' }] });
    expect(s.state.requests).toEqual([]);
    await expect(s.close()).resolves.toMatchObject({ status: 'CLOSED' });
  });

  it('requires a safe mail origin before creating proof', async () => {
    const s = setup(); s.values.WEB_BASE_URL = 'https://user:secret@example.com';
    await expect(s.service.requestVerification('u1')).rejects.toBeInstanceOf(BadRequestException);
    expect(s.tx.authOneTimeToken.create).not.toHaveBeenCalled();
  });
});
