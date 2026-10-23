import { BadRequestException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { AccountClosureService } from './account-closure.service';

const token = 'a'.repeat(43);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

function setup() {
  const user = { id: 'u1', email: 'member@example.com', status: 'ACTIVE', role: 'USER', name: 'Member', avatar: 'avatar' };
  const proof = { id: 'proof1', userId: 'u1', type: 'ACCOUNT_CLOSURE', tokenHash: digest(token),
    consumedAt: null as Date | null, metadata: { email: user.email }, expiresAt: new Date(Date.now() + 60_000) };
  let request: any = null;
  const count = () => jest.fn().mockResolvedValue(0);
  const deleted = () => ({ deleteMany: jest.fn().mockResolvedValue({ count: 1 }) });
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: user.id }]),
    user: {
      findUnique: jest.fn(async () => ({ ...user })),
      update: jest.fn(async ({ data }) => Object.assign(user, data)),
    },
    enterpriseMember: { count: count() },
    personalWallet: { findUnique: jest.fn().mockResolvedValue({ balance: new Prisma.Decimal(0) }) },
    personalRechargeOrder: { count: count() }, contributionRewardEvent: { count: count() },
    taskRun: { count: count() }, clientTaskMirror: { count: count() },
    gatewayExecution: { count: count() }, mediaRealBillingReservation: { count: count() }, order: { count: count() },
    accountClosureRequest: {
      findUnique: jest.fn(async ({ where }) => {
        if (!request) return null;
        if (where.activeUserId) return request.activeUserId === where.activeUserId ? { ...request } : null;
        if (where.cancellationTokenHash) return request.cancellationTokenHash === where.cancellationTokenHash ? { ...request } : null;
        return request.id === where.id ? { ...request } : null;
      }),
      create: jest.fn(async ({ data }) => (request = { id: 'request1', status: 'PREPARING', ...data })),
      updateMany: jest.fn(async ({ where, data }) => {
        if (!request || (where.status && request.status !== where.status) ||
          (where.cancellationTokenHash && request.cancellationTokenHash !== where.cancellationTokenHash) ||
          (where.scheduledFor?.gt && request.scheduledFor <= where.scheduledFor.gt)) return { count: 0 };
        Object.assign(request, data);
        return { count: 1 };
      }),
      update: jest.fn(async ({ data }) => Object.assign(request, data)),
      findMany: jest.fn(async () => request ? [{ id: request.id, userId: request.userId }] : []),
    },
    authOneTimeToken: {
      findUnique: jest.fn(async () => ({ ...proof })),
      create: jest.fn().mockResolvedValue({}), update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }), ...deleted(),
    },
    authSession: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    authToken: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), ...deleted() },
    device: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), ...deleted() },
    authOAuthTransaction: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), ...deleted() },
    authCredential: deleted(), authIdentity: deleted(), notification: deleted(),
    authEvent: { create: jest.fn().mockResolvedValue({}), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    enterpriseInvitation: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  const prisma = { ...tx, $transaction: jest.fn(async (fn) => {
    const snapshot = { user: { ...user }, request: request ? { ...request } : null };
    try { return await fn(tx); } catch (error) {
      Object.assign(user, snapshot.user); request = snapshot.request; throw error;
    }
  }) };
  const mail = { sendAccountClosureVerification: jest.fn().mockResolvedValue(undefined), sendAccountClosureRequested: jest.fn().mockResolvedValue(undefined), sendAccountClosureRecovery: jest.fn().mockResolvedValue(undefined) };
  const values: Record<string, string> = { WEB_BASE_URL: 'https://app.example.com', NODE_ENV: 'test' };
  const config = { get: (key: string) => values[key], getOrThrow: (key: string) => values[key] };
  const limits = { consume: jest.fn().mockResolvedValue({ allowed: true }) };
  const service = new AccountClosureService(prisma as any, mail as any, config as any, limits as any);
  const pending = async () => {
    const result = await service.request(user.id, { token, confirmation: '注销账号' });
    const cancellationToken = new URL(mail.sendAccountClosureRequested.mock.calls[0][0].cancellationUrl).searchParams.get('token')!;
    return { result, cancellationToken };
  };
  return { service, prisma, tx, user, proof, mail, limits, values, pending, request: () => request };
}

describe('AccountClosureService', () => {
  it('blocks unresolved media reconciliation even after the reservation has left RESERVED', async () => {
    const s = setup();
    s.tx.mediaRealBillingReservation.count.mockImplementation(async (query: any) =>
      query.where.status.in.includes('RECONCILING') ? 1 : 0,
    );
    await expect(s.service.eligibility('u1')).resolves.toMatchObject({
      eligible: false,
      blockers: [{ code: 'BILLING_RECONCILIATION' }],
    });
    await expect(s.pending()).rejects.toBeInstanceOf(ConflictException);
    expect(s.mail.sendAccountClosureRequested).not.toHaveBeenCalled();
  });

  it('returns separate actionable blockers for memberships, money, rewards, tasks and reconciliation', async () => {
    const s = setup();
    s.tx.enterpriseMember.count.mockResolvedValue(1);
    s.tx.personalWallet.findUnique.mockResolvedValue({ balance: new Prisma.Decimal('0.01') });
    s.tx.personalRechargeOrder.count.mockResolvedValue(1);
    s.tx.contributionRewardEvent.count.mockResolvedValue(1);
    s.tx.clientTaskMirror.count.mockResolvedValue(1);
    s.tx.gatewayExecution.count.mockResolvedValue(1);
    const result = await s.service.eligibility('u1');
    expect(result).toEqual({ eligible: false, gracePeriodDays: 7, blockers: expect.arrayContaining([
      expect.objectContaining({ code: 'ENTERPRISE_MEMBERSHIP' }), expect.objectContaining({ code: 'PERSONAL_BALANCE' }),
      expect.objectContaining({ code: 'PENDING_PAYMENT' }), expect.objectContaining({ code: 'UNSETTLED_REWARD' }),
      expect.objectContaining({ code: 'ACTIVE_TASK' }), expect.objectContaining({ code: 'BILLING_RECONCILIATION' }),
    ]) });
  });

  it.each(['DISABLED', 'CLOSURE_PENDING', 'CLOSED'])('rejects %s before sending proof mail', async (status) => {
    const s = setup(); s.user.status = status;
    await expect(s.service.requestVerification('u1')).rejects.toBeInstanceOf(ConflictException);
    expect(s.mail.sendAccountClosureVerification).not.toHaveBeenCalled();
  });

  it('issues a dedicated email-bound hashed proof and never changes account state', async () => {
    const s = setup();
    await s.service.requestVerification('u1');
    const url = new URL(s.mail.sendAccountClosureVerification.mock.calls[0][0].verificationUrl);
    const raw = url.searchParams.get('token')!;
    expect(url.pathname).toBe('/account-closure');
    expect(s.tx.authOneTimeToken.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      type: 'ACCOUNT_CLOSURE', tokenHash: digest(raw), metadata: { email: s.user.email },
    }) });
    expect(s.tx.user.update).not.toHaveBeenCalled();
    expect(s.user.status).toBe('ACTIVE');
  });

  it('limits verification mail per user', async () => {
    const s = setup(); s.limits.consume.mockResolvedValue({ allowed: false });
    await expect(s.service.requestVerification('u1')).rejects.toMatchObject({ status: 429 });
    expect(s.tx.authOneTimeToken.create).not.toHaveBeenCalled();
  });

  it('invalidates undelivered verification proof', async () => {
    const s = setup(); s.mail.sendAccountClosureVerification.mockRejectedValue(new ServiceUnavailableException());
    await expect(s.service.requestVerification('u1')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(s.prisma.authOneTimeToken.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ tokenHash: expect.any(String) }) }));
    expect(s.user.status).toBe('ACTIVE');
  });

  it.each(['foreign-user', 'expired', 'consumed', 'wrong-purpose', 'email-changed'])('rejects %s proof before reserving', async (kind) => {
    const s = setup();
    if (kind === 'foreign-user') s.proof.userId = 'u2';
    if (kind === 'expired') s.proof.expiresAt = new Date(Date.now() - 1);
    if (kind === 'consumed') s.proof.consumedAt = new Date();
    if (kind === 'wrong-purpose') s.proof.type = 'PASSWORD_RESET';
    if (kind === 'email-changed') s.user.email = 'changed@example.com';
    await expect(s.service.request('u1', { token, confirmation: '注销账号' })).rejects.toBeInstanceOf(BadRequestException);
    expect(s.tx.accountClosureRequest.create).not.toHaveBeenCalled();
  });

  it('activates only after recovery mail delivery and revokes all ordinary credentials', async () => {
    const s = setup();
    s.mail.sendAccountClosureRequested.mockImplementation(async () => {
      expect(s.user.status).toBe('ACTIVE');
      expect(s.request().status).toBe('PREPARING');
      expect(s.tx.authSession.updateMany).not.toHaveBeenCalled();
    });
    const { result, cancellationToken } = await s.pending();
    expect(s.user.status).toBe('CLOSURE_PENDING');
    expect(s.request()).toMatchObject({ status: 'PENDING', cancellationTokenHash: digest(cancellationToken), activeUserId: 'u1' });
    expect(JSON.stringify(s.request())).not.toContain(cancellationToken);
    expect(new Date(result.scheduledFor).getTime() - Date.now()).toBeGreaterThan(6.99 * 86400000);
    expect(s.tx.authToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { session: { userId: 'u1' }, revokedAt: null } }));
    expect(s.tx.device.updateMany).not.toHaveBeenCalled();
    expect(s.tx.authOAuthTransaction.updateMany).toHaveBeenCalled();
  });

  it('keeps ACTIVE and leaves proof retryable if recovery mail fails', async () => {
    const s = setup(); s.mail.sendAccountClosureRequested.mockRejectedValue(new ServiceUnavailableException());
    await expect(s.pending()).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(s.user.status).toBe('ACTIVE');
    expect(s.request()).toMatchObject({ status: 'CANCELLED', activeUserId: null, cancellationTokenHash: null });
    expect(s.tx.authOneTimeToken.update).not.toHaveBeenCalled();
    expect(s.tx.authSession.updateMany).not.toHaveBeenCalled();
  });

  it('rechecks new blockers after sending mail and cancels reservation on conflict', async () => {
    const s = setup();
    s.mail.sendAccountClosureRequested.mockImplementation(async () => { s.tx.enterpriseMember.count.mockResolvedValue(1); });
    await expect(s.pending()).rejects.toBeInstanceOf(ConflictException);
    expect(s.user.status).toBe('ACTIVE');
    expect(s.request().status).toBe('CANCELLED');
    expect(s.tx.authSession.updateMany).not.toHaveBeenCalled();
  });

  it('does not allow a second application while recovery mail is being delivered', async () => {
    const s = setup();
    s.mail.sendAccountClosureRequested.mockImplementation(async () => {
      await expect(s.service.request('u1', { token, confirmation: '注销账号' })).rejects.toBeInstanceOf(ConflictException);
    });
    await s.pending();
    expect(s.tx.accountClosureRequest.create).toHaveBeenCalledTimes(1);
  });

  it('GET preview is read only, POST cancel restores ACTIVE without restoring sessions and cannot replay', async () => {
    const s = setup(); const { cancellationToken } = await s.pending();
    s.tx.user.update.mockClear(); s.tx.authSession.updateMany.mockClear();
    await expect(s.service.previewCancellation(cancellationToken)).resolves.toMatchObject({ canCancel: true });
    expect(s.tx.user.update).not.toHaveBeenCalled();
    expect(s.user.status).toBe('CLOSURE_PENDING');
    await s.service.cancel(cancellationToken);
    expect(s.user.status).toBe('ACTIVE');
    expect(s.request().status).toBe('CANCELLED');
    expect(s.tx.authSession.updateMany).not.toHaveBeenCalled();
    await expect(s.service.cancel(cancellationToken)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses cancellation at the deadline even if finalization has not yet run', async () => {
    const s = setup(); const { cancellationToken } = await s.pending(); s.request().scheduledFor = new Date(Date.now() - 1);
    await expect(s.service.cancel(cancellationToken)).rejects.toBeInstanceOf(BadRequestException);
    expect(s.user.status).toBe('CLOSURE_PENDING');
  });

  it('rechecks cancellation condition after acquiring the user lock', async () => {
    const s = setup(); const { cancellationToken } = await s.pending();
    s.tx.accountClosureRequest.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(s.service.cancel(cancellationToken)).rejects.toBeInstanceOf(BadRequestException);
    expect(s.user.status).toBe('CLOSURE_PENDING');
  });

  it('anonymizes once, releases email, invalidates old invitations and preserves business records', async () => {
    const s = setup(); await s.pending(); s.request().scheduledFor = new Date(Date.now() - 1);
    await s.service.finalize('request1', 'u1');
    expect(s.user).toMatchObject({ id: 'u1', email: expect.stringMatching(/^closed\+u1\.[a-f0-9]{32}@account\.invalid$/), status: 'CLOSED', name: '已注销用户', avatar: null });
    expect(s.tx.enterpriseInvitation.updateMany).toHaveBeenCalledWith({ where: { email: { equals: 'member@example.com', mode: 'insensitive' }, status: 'PENDING' }, data: { status: 'REVOKED' } });
    expect(s.tx.authCredential.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
    expect(s.tx.authIdentity.deleteMany).toHaveBeenCalled();
    expect(s.tx.notification.deleteMany).toHaveBeenCalled();
    expect(s.request()).toMatchObject({ status: 'COMPLETED', activeUserId: null, cancellationTokenHash: null });
    s.tx.user.update.mockClear();
    await s.service.finalize('request1', 'u1');
    expect(s.tx.user.update).not.toHaveBeenCalled();
  });

  it('does not finalize before deadline or after cancellation', async () => {
    const s = setup(); const { cancellationToken } = await s.pending(); s.tx.user.update.mockClear();
    await s.service.finalize('request1', 'u1'); expect(s.tx.user.update).not.toHaveBeenCalled();
    await s.service.cancel(cancellationToken); s.tx.user.update.mockClear();
    s.request().scheduledFor = new Date(Date.now() - 1);
    await s.service.finalize('request1', 'u1'); expect(s.tx.user.update).not.toHaveBeenCalled();
  });

  it('keeps email reserved and records safe retry reason if a new financial blocker exists', async () => {
    const s = setup(); await s.pending(); s.request().scheduledFor = new Date(Date.now() - 1);
    s.tx.personalWallet.findUnique.mockResolvedValue({ balance: new Prisma.Decimal(1) });
    // Cleanup query must not affect a PENDING request in the test store.
    await s.service.processDueRequests();
    expect(s.user).toMatchObject({ status: 'CLOSURE_PENDING', email: 'member@example.com' });
    expect(s.request()).toMatchObject({ status: 'PENDING', lastError: 'ELIGIBILITY_BLOCKED' });
    expect(s.tx.authIdentity.deleteMany).not.toHaveBeenCalled();
  });

  it('requires a safe configured mail origin before creating any proof', async () => {
    const s = setup(); s.values.WEB_BASE_URL = 'https://user:secret@example.com';
    await expect(s.service.requestVerification('u1')).rejects.toBeInstanceOf(BadRequestException);
    expect(s.tx.authOneTimeToken.create).not.toHaveBeenCalled();
  });

  it('recovery returns the same response for absent, active and pending accounts', async () => {
    const s = setup();
    s.prisma.user.findUnique.mockResolvedValueOnce(null as any);
    const missing = await s.service.recover(s.user.email, '127.0.0.1');
    const active = await s.service.recover(s.user.email, '127.0.0.1');
    expect(s.mail.sendAccountClosureRecovery).not.toHaveBeenCalled();
    await s.pending();
    const pending = await s.service.recover(s.user.email, '127.0.0.1');
    expect(pending).toEqual(active); expect(active).toEqual(missing);
    expect(s.mail.sendAccountClosureRecovery).toHaveBeenCalledTimes(1);
  });

  it('recovery rotates the cancellation credential only after successful SMTP delivery', async () => {
    const s = setup(); const { cancellationToken } = await s.pending();
    s.mail.sendAccountClosureRecovery.mockImplementation(async () => {
      expect(s.request().cancellationTokenHash).toBe(digest(cancellationToken));
    });
    await s.service.recover(s.user.email);
    const url = new URL(s.mail.sendAccountClosureRecovery.mock.calls[0][0].cancellationUrl);
    const nextToken = url.searchParams.get('token')!;
    await expect(s.service.previewCancellation(cancellationToken)).rejects.toBeInstanceOf(BadRequestException);
    await expect(s.service.previewCancellation(nextToken)).resolves.toMatchObject({ canCancel: true });
  });

  it('recovery mail failure keeps the old cancellation credential and returns the same public message', async () => {
    const s = setup(); const { cancellationToken } = await s.pending();
    s.mail.sendAccountClosureRecovery.mockRejectedValue(new Error('smtp secret'));
    await expect(s.service.recover(s.user.email)).resolves.toMatchObject({ message: expect.any(String) });
    await expect(s.service.previewCancellation(cancellationToken)).resolves.toMatchObject({ canCancel: true });
  });

  it('does not restore or rotate a request cancelled while recovery mail was in flight', async () => {
    const s = setup(); const { cancellationToken } = await s.pending();
    s.mail.sendAccountClosureRecovery.mockImplementation(async () => { await s.service.cancel(cancellationToken); });
    await s.service.recover(s.user.email);
    expect(s.user.status).toBe('ACTIVE');
    expect(s.request()).toMatchObject({ status: 'CANCELLED', cancellationTokenHash: null });
  });

  it('does not send recovery mail after the deadline or when rate limited', async () => {
    const s = setup(); await s.pending(); s.request().scheduledFor = new Date(Date.now() - 1);
    await s.service.recover(s.user.email); expect(s.mail.sendAccountClosureRecovery).not.toHaveBeenCalled();
    s.request().scheduledFor = new Date(Date.now() + 100000); s.limits.consume.mockResolvedValue({ allowed: false });
    await s.service.recover(s.user.email); expect(s.mail.sendAccountClosureRecovery).not.toHaveBeenCalled();
  });

  it('records a safe failure code and retries without releasing email after a transaction error', async () => {
    const s = setup(); await s.pending(); s.request().scheduledFor = new Date(Date.now() - 1);
    s.tx.authIdentity.deleteMany.mockRejectedValueOnce(new Error('private database error'));
    await s.service.processDueRequests();
    expect(s.user).toMatchObject({ status: 'CLOSURE_PENDING', email: 'member@example.com' });
    expect(s.request()).toMatchObject({ status: 'PENDING', lastError: 'FINALIZATION_FAILED' });
    await s.service.processDueRequests(); expect(s.user.status).toBe('CLOSED');
  });
});
