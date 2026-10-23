import {
  BadRequestException, ConflictException, HttpException, HttpStatus, Injectable,
  Logger, UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { Prisma, User } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { AccountClosureEligibility, AccountClosureRequestDto, AccountClosureResult } from 'shared';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { AuthRateLimitService } from './auth-rate-limit.service';

const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class AccountClosureService {
  private readonly logger = new Logger(AccountClosureService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
    private readonly limits: AuthRateLimitService,
  ) {}

  private gracePeriodDays(): number {
    const days = Number(this.config.get<string>('ACCOUNT_CLOSURE_GRACE_DAYS') ?? 7);
    return Number.isInteger(days) && days >= 1 && days <= 30 ? days : 7;
  }

  private link(path: string, token: string): string {
    let url: URL;
    try {
      url = new URL(this.config.getOrThrow<string>('WEB_BASE_URL'));
    } catch {
      throw new BadRequestException('平台邮件链接地址尚未配置');
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      (this.config.get('NODE_ENV') === 'production' && url.protocol !== 'https:')) {
      throw new BadRequestException('平台邮件链接地址配置无效');
    }
    url = new URL(path, url.origin);
    url.searchParams.set('token', token);
    return url.toString();
  }

  private async lockUser(tx: Prisma.TransactionClient, userId: string): Promise<User> {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('账号不存在');
    return user;
  }

  private active(user: User): void {
    if (user.status !== 'ACTIVE') throw new ConflictException('账号当前不可申请注销');
  }

  private async blockers(tx: Prisma.TransactionClient, user: User): Promise<AccountClosureEligibility['blockers']> {
    const [memberships, wallet, recharges, rewards, tasks, mirrors, executions, media, orders] = await Promise.all([
      tx.enterpriseMember.count({ where: { userId: user.id } }),
      tx.personalWallet.findUnique({ where: { userId: user.id }, select: { balance: true } }),
      tx.personalRechargeOrder.count({ where: { userId: user.id, status: 'PENDING' } }),
      tx.contributionRewardEvent.count({ where: { recipientId: user.id, status: { in: ['PENDING', 'AVAILABLE'] } } }),
      tx.taskRun.count({ where: { userId: user.id, status: { in: ['RUNNING', 'AWAITING_CONFIRMATION'] } } }),
      tx.clientTaskMirror.count({ where: { userId: user.id, status: { notIn: ['COMPLETED', 'FAILED', 'CANCELLED', 'STOPPED'] } } }),
      tx.gatewayExecution.count({ where: { userId: user.id, status: { in: ['STARTED', 'USAGE_PENDING', 'NEEDS_RECONCILIATION'] } } }),
      tx.mediaRealBillingReservation.count({ where: { userId: user.id, status: { in: ['RESERVED', 'RECONCILING'] } } }),
      tx.order.count({ where: { createdBy: user.id, status: 'PENDING' } }),
    ]);
    const blockers: AccountClosureEligibility['blockers'] = [];
    if (user.role === 'ADMIN') blockers.push({ code: 'PLATFORM_ADMIN', message: '平台管理员请先联系平台完成管理职责交接' });
    if (memberships) blockers.push({ code: 'ENTERPRISE_MEMBERSHIP', message: '请先退出所有企业；唯一管理员需先安排其他管理员' });
    if (wallet && !wallet.balance.isZero()) blockers.push({ code: 'PERSONAL_BALANCE', message: '个人钱包余额尚未结清，请联系平台处理' });
    if (recharges || orders) blockers.push({ code: 'PENDING_PAYMENT', message: '存在待支付订单，请先完成支付或关闭订单' });
    if (rewards) blockers.push({ code: 'UNSETTLED_REWARD', message: '个人贡献收益尚未结算，请联系平台处理' });
    if (tasks || mirrors) blockers.push({ code: 'ACTIVE_TASK', message: '存在运行中、排队中或待确认任务，请先完成或停止任务' });
    if (executions || media) blockers.push({ code: 'BILLING_RECONCILIATION', message: '存在未完成的用量结算或对账，请稍后重试或联系平台' });
    return blockers;
  }

  private async assertEligible(tx: Prisma.TransactionClient, user: User): Promise<void> {
    const blockers = await this.blockers(tx, user);
    if (blockers.length) throw new ConflictException({ message: '暂不满足注销条件', blockers });
  }

  async eligibility(userId: string): Promise<AccountClosureEligibility> {
    return this.prisma.$transaction(async (tx) => {
      const user = await this.lockUser(tx, userId);
      this.active(user);
      const blockers = await this.blockers(tx, user);
      return { eligible: blockers.length === 0, gracePeriodDays: this.gracePeriodDays(), blockers };
    });
  }

  async requestVerification(userId: string): Promise<{ message: string }> {
    const rate = await this.limits.consume('account_closure_email', userId, { limit: 1, windowSeconds: 60 });
    if (!rate.allowed) throw new HttpException('请稍后再发送注销确认邮件', HttpStatus.TOO_MANY_REQUESTS);
    const token = randomBytes(32).toString('base64url');
    const verificationUrl = this.link('/account-closure', token);
    const user = await this.prisma.$transaction(async (tx) => {
      const user = await this.lockUser(tx, userId);
      this.active(user);
      await this.assertEligible(tx, user);
      if (await tx.accountClosureRequest.findUnique({ where: { activeUserId: userId } })) {
        throw new ConflictException('已有注销申请正在处理，请稍后重试');
      }
      await tx.authOneTimeToken.updateMany({ where: { userId, type: 'ACCOUNT_CLOSURE', consumedAt: null }, data: { consumedAt: new Date() } });
      await tx.authOneTimeToken.create({ data: {
        userId, type: 'ACCOUNT_CLOSURE', tokenHash: hash(token),
        metadata: { email: user.email }, expiresAt: new Date(Date.now() + 20 * 60 * 1000),
      } });
      return user;
    });
    try {
      await this.mail.sendAccountClosureVerification({ to: user.email, verificationUrl });
    } catch (error) {
      await this.prisma.authOneTimeToken.updateMany({ where: { tokenHash: hash(token), consumedAt: null }, data: { consumedAt: new Date() } });
      throw error;
    }
    return { message: '注销确认邮件已发送，请在 20 分钟内打开邮件链接' };
  }

  private async proof(tx: Prisma.TransactionClient, user: User, token: string) {
    const proof = await tx.authOneTimeToken.findUnique({ where: { tokenHash: hash(token) } });
    const metadata = proof?.metadata as { email?: string } | null;
    if (!proof || proof.userId !== user.id || proof.type !== 'ACCOUNT_CLOSURE' || proof.consumedAt ||
      proof.expiresAt <= new Date() || metadata?.email !== user.email) {
      throw new BadRequestException('注销确认链接无效或已过期，请重新发送');
    }
    return proof;
  }

  async request(userId: string, dto: AccountClosureRequestDto): Promise<AccountClosureResult> {
    const cancellationToken = randomBytes(32).toString('base64url');
    const cancellationUrl = this.link('/account-closure/cancel', cancellationToken);
    // Reserve first, deliver recovery mail without holding locks, then activate atomically.
    const prepared = await this.prisma.$transaction(async (tx) => {
      const user = await this.lockUser(tx, userId);
      this.active(user);
      await this.proof(tx, user, dto.token);
      await this.assertEligible(tx, user);
      if (await tx.accountClosureRequest.findUnique({ where: { activeUserId: userId } })) {
        throw new ConflictException('已有注销申请正在处理，请稍后重试');
      }
      const request = await tx.accountClosureRequest.create({ data: {
        userId, activeUserId: userId, cancellationTokenHash: hash(cancellationToken),
        scheduledFor: new Date(Date.now() + this.gracePeriodDays() * DAY),
      } });
      return { user, request };
    });
    try {
      await this.mail.sendAccountClosureRequested({ to: prepared.user.email, cancellationUrl, scheduledFor: prepared.request.scheduledFor });
      await this.prisma.$transaction(async (tx) => {
        const user = await this.lockUser(tx, userId);
        this.active(user);
        const proof = await this.proof(tx, user, dto.token);
        await this.assertEligible(tx, user);
        const changed = await tx.accountClosureRequest.updateMany({
          where: { id: prepared.request.id, status: 'PREPARING', activeUserId: userId },
          data: { status: 'PENDING' },
        });
        if (changed.count !== 1) throw new ConflictException('注销申请已失效，请重新申请');
        await tx.authOneTimeToken.update({ where: { id: proof.id }, data: { consumedAt: new Date() } });
        await tx.user.update({ where: { id: userId }, data: { status: 'CLOSURE_PENDING' } });
        await this.revoke(tx, userId);
        await tx.authEvent.create({ data: { userId, action: 'ACCOUNT_CLOSURE_REQUESTED', metadata: { requestId: prepared.request.id } } });
      });
    } catch (error) {
      await this.prisma.accountClosureRequest.updateMany({
        where: { id: prepared.request.id, status: 'PREPARING' },
        data: { status: 'CANCELLED', activeUserId: null, cancellationTokenHash: null, cancelledAt: new Date() },
      });
      throw error;
    }
    return { requestId: prepared.request.id, status: 'PENDING', scheduledFor: prepared.request.scheduledFor.toISOString() };
  }

  private async revoke(tx: Prisma.TransactionClient, userId: string): Promise<void> {
    const now = new Date();
    await tx.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now, revokeReason: 'account_closure' } });
    await tx.authToken.updateMany({ where: { session: { userId }, revokedAt: null }, data: { revokedAt: now, revokeReason: 'account_closure' } });
    await tx.authOneTimeToken.updateMany({ where: { userId, consumedAt: null }, data: { consumedAt: now } });
    await tx.authOAuthTransaction.updateMany({ where: { userId, consumedAt: null }, data: { consumedAt: now } });
  }

  private async cancellationRequest(token: string) {
    const request = await this.prisma.accountClosureRequest.findUnique({ where: { cancellationTokenHash: hash(token) } });
    if (!request || request.status !== 'PENDING' || request.scheduledFor <= new Date()) {
      throw new BadRequestException('撤回链接无效或已超过撤回期限');
    }
    return request;
  }

  async previewCancellation(token: string) {
    const request = await this.cancellationRequest(token);
    return { status: 'PENDING' as const, scheduledFor: request.scheduledFor.toISOString(), canCancel: true };
  }

  async recover(email: string, ipAddress?: string): Promise<{ message: string }> {
    const response = { message: '若该邮箱有可撤回的注销申请，撤回邮件已发送，请检查邮箱' };
    const emailRate = await this.limits.consume('account_closure_recovery_email', email, { limit: 1, windowSeconds: 60 });
    const ipRate = await this.limits.consume('account_closure_recovery_ip', ipAddress ?? 'unknown', { limit: 5, windowSeconds: 600 });
    if (!emailRate.allowed || !ipRate.allowed) return response;
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.status !== 'CLOSURE_PENDING') return response;
    const request = await this.prisma.accountClosureRequest.findUnique({ where: { activeUserId: user.id } });
    if (!request || request.status !== 'PENDING' || request.scheduledFor <= new Date()) return response;
    const token = randomBytes(32).toString('base64url');
    try {
      await this.mail.sendAccountClosureRecovery({ to: email, cancellationUrl: this.link('/account-closure/cancel', token), scheduledFor: request.scheduledFor });
      await this.prisma.$transaction(async (tx) => {
        const current = await this.lockUser(tx, user.id);
        if (current.status !== 'CLOSURE_PENDING' || current.email !== email) return;
        await tx.accountClosureRequest.updateMany({
          where: { id: request.id, status: 'PENDING', cancellationTokenHash: request.cancellationTokenHash, scheduledFor: { gt: new Date() } },
          data: { cancellationTokenHash: hash(token) },
        });
      });
    } catch {
      // Public recovery never reveals account existence; failed delivery leaves the old link valid.
      this.logger.warn('注销撤回邮件重发失败');
    }
    return response;
  }

  async cancel(token: string): Promise<{ message: string }> {
    const request = await this.cancellationRequest(token);
    await this.prisma.$transaction(async (tx) => {
      const user = await this.lockUser(tx, request.userId);
      if (user.status !== 'CLOSURE_PENDING') throw new ConflictException('注销申请当前不可撤回');
      const changed = await tx.accountClosureRequest.updateMany({
        where: { id: request.id, cancellationTokenHash: hash(token), status: 'PENDING', scheduledFor: { gt: new Date() } },
        data: { status: 'CANCELLED', activeUserId: null, cancellationTokenHash: null, cancelledAt: new Date() },
      });
      if (changed.count !== 1) throw new BadRequestException('撤回链接无效或已超过撤回期限');
      await tx.user.update({ where: { id: user.id }, data: { status: 'ACTIVE' } });
      await tx.authEvent.create({ data: { userId: user.id, action: 'ACCOUNT_CLOSURE_CANCELLED', metadata: { requestId: request.id } } });
    });
    return { message: '注销申请已撤销，请重新登录' };
  }

  @Cron('*/5 * * * *')
  async processDueRequests(): Promise<void> {
    await this.prisma.accountClosureRequest.updateMany({
      where: { status: 'PREPARING', updatedAt: { lt: new Date(Date.now() - 30 * 60 * 1000) } },
      data: { status: 'CANCELLED', activeUserId: null, cancellationTokenHash: null, cancelledAt: new Date() },
    });
    const requests = await this.prisma.accountClosureRequest.findMany({
      where: { status: 'PENDING', scheduledFor: { lte: new Date() } },
      orderBy: { scheduledFor: 'asc' }, take: 100, select: { id: true, userId: true },
    });
    for (const request of requests) {
      try {
        await this.finalize(request.id, request.userId);
      } catch (error) {
        const lastError = error instanceof ConflictException ? 'ELIGIBILITY_BLOCKED' : 'FINALIZATION_FAILED';
        await this.prisma.accountClosureRequest.updateMany({
          where: { id: request.id, status: 'PENDING' },
          data: { lastError, lastAttemptAt: new Date(), attempts: { increment: 1 } },
        });
        this.logger.warn(`注销执行待重试 request=${request.id} reason=${lastError}`);
      }
    }
  }

  async finalize(requestId: string, userId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const user = await this.lockUser(tx, userId);
      const request = await tx.accountClosureRequest.findUnique({ where: { id: requestId } });
      if (!request || request.userId !== userId || request.status !== 'PENDING' || request.scheduledFor > new Date()) return;
      if (user.status !== 'CLOSURE_PENDING') throw new ConflictException('注销状态异常');
      await this.assertEligible(tx, user);
      await this.revoke(tx, userId);
      await tx.enterpriseInvitation.updateMany({ where: { email: { equals: user.email, mode: 'insensitive' }, status: 'PENDING' }, data: { status: 'REVOKED' } });
      await tx.authToken.deleteMany({ where: { session: { userId } } });
      await tx.authSession.updateMany({ where: { userId }, data: { ipAddress: null, userAgent: null } });
      await tx.device.deleteMany({ where: { userId } });
      await tx.authCredential.deleteMany({ where: { userId } });
      await tx.authIdentity.deleteMany({ where: { userId } });
      await tx.authOneTimeToken.deleteMany({ where: { userId } });
      await tx.authOAuthTransaction.deleteMany({ where: { userId } });
      await tx.notification.deleteMany({ where: { userId } });
      await tx.authEvent.updateMany({ where: { userId }, data: { ipAddress: null, userAgent: null, metadata: Prisma.DbNull } });
      await tx.user.update({ where: { id: userId }, data: {
        status: 'CLOSED', email: `closed+${userId}.${randomBytes(16).toString('hex')}@account.invalid`, name: '已注销用户',
        avatar: null, emailVerifiedAt: null, role: 'USER',
      } });
      await tx.accountClosureRequest.update({ where: { id: requestId }, data: {
        status: 'COMPLETED', activeUserId: null, cancellationTokenHash: null,
        completedAt: new Date(), lastAttemptAt: new Date(), attempts: { increment: 1 }, lastError: null,
      } });
      await tx.authEvent.create({ data: { userId, action: 'ACCOUNT_CLOSED', metadata: { requestId } } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15_000 });
  }
}
