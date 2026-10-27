import { Type } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { JwtService } from '@nestjs/jwt';
import { SkipThrottle } from '@nestjs/throttler';
import { THROTTLER_LIMIT } from '@nestjs/throttler/dist/throttler.constants';
import { AuthController } from '../auth/auth.controller';
import { AccountClosureController } from '../auth/account-closure.controller';
import { ClientController } from '../client/client.controller';
import { ConversationController } from '../conversation/conversation.controller';
import { TaskExecutionController } from '../task-execution/task-execution.controller';
import { TaskPlanningController } from '../task-planning/task-planning.controller';
import { businessTracker, skipUnselectedRule } from './rate-limit-policy';

function context(controller: Type<any>, handler: string) {
  expect(controller.prototype[handler]).toEqual(expect.any(Function));
  return new ExecutionContextHost([], controller, controller.prototype[handler]);
}

describe('Explicit named rate-limit policies', () => {
  const authHandlers = [
    [AuthController, 'requestRegistrationEmailCode', 5],
    [AuthController, 'register', 5],
    [AuthController, 'verifyInvitation', 10],
    [AuthController, 'registerByInvitation', 5],
    [AuthController, 'login', 10],
    [AuthController, 'requestPasswordReset', 5],
    [AuthController, 'resetPassword', 10],
    [AuthController, 'changePassword', 10],
    [AuthController, 'requestEmailVerification', 3],
    [AuthController, 'confirmEmailVerification', 10],
    [AuthController, 'requestEmailChange', 3],
    [AuthController, 'confirmEmailChange', 10],
    [AuthController, 'oauthRegisterStart', 10],
    [AuthController, 'oauthInvitationStart', 10],
    [AuthController, 'oauthStart', 10],
    [AuthController, 'oauthLinkStart', 10],
    [AuthController, 'oauthCallback', 10],
    [AuthController, 'unlinkOAuth', 10],
    [AuthController, 'refresh', 10],
    [AccountClosureController, 'verification', 3],
    [AccountClosureController, 'request', 5],
    [ClientController, 'login', 10],
    [ClientController, 'refreshAccessToken', 10],
    [ClientController, 'refreshInstanceToken', 10],
  ] as const;
  it.each(authHandlers)('%p.%s retains auth quota %i and never selects chat', (controller, handler, limit) => {
    const ctx = context(controller, handler);
    expect(skipUnselectedRule('auth', ctx)).toBe(false);
    expect(Reflect.getMetadata(THROTTLER_LIMIT + 'auth', ctx.getHandler())).toBe(limit);
    expect(skipUnselectedRule('chat', ctx)).toBe(true);
  });

  it.each([
    [ConversationController, 'sendMessage'], [TaskPlanningController, 'preview'],
    [TaskExecutionController, 'run'], [TaskExecutionController, 'retry'], [TaskExecutionController, 'resume'],
  ] as const)('%p.%s selects chat 60/60s without auth', (controller, handler) => {
    const ctx = context(controller, handler);
    expect(skipUnselectedRule('chat', ctx)).toBe(false);
    expect(Reflect.getMetadata(THROTTLER_LIMIT + 'chat', ctx.getHandler())).toBe(60);
    expect(skipUnselectedRule('auth', ctx)).toBe(true);
  });

  it.each([
    ...['oauthProviders', 'oauthIdentities', 'listSessions', 'listAuthEvents', 'getMe', 'logout', 'logoutAll', 'revokeSession']
      .map(handler => [AuthController, handler] as const),
    ...['getProfile', 'getComputeBalance', 'listSubscriptions', 'getRuntime']
      .map(handler => [ClientController, handler] as const),
    ...['create', 'findAll', 'findOne', 'update', 'switchModel', 'remove']
      .map(handler => [ConversationController, handler] as const),
    ...['execution', 'stop', 'pause', 'stepMessages', 'deliverable', 'stream']
      .map(handler => [TaskExecutionController, handler] as const),
    [AccountClosureController, 'eligibility'] as const,
  ])('%p.%s is ordinary business without auth/chat quotas', (controller, handler) => {
    const ctx = context(controller, handler);
    expect(skipUnselectedRule('auth', ctx)).toBe(true);
    expect(skipUnselectedRule('chat', ctx)).toBe(true);
  });

  it('supports explicit named enablement via SkipThrottle(false)', () => {
    class OptInController {
      @SkipThrottle({ auth: false }) selected() {}
    }
    expect(skipUnselectedRule('auth', context(OptInController, 'selected'))).toBe(false);
  });
});

describe('Business rate-limit identity', () => {
  const secret = 'rate-limit-policy-test-only-secret';
  const jwt = new JwtService({ secret });
  const tracker = businessTracker(new ConfigService({ ACCESS_JWT_SECRET: secret }), jwt);
  const req = (bearer?: string, ip = '::ffff:192.0.2.20') => ({
    ip, headers: { authorization: bearer ? `Bearer ${bearer}` : undefined,
      'x-user-id': 'forged-user', 'x-forwarded-for': '203.0.113.20' },
    user: { id: 'forged-user' },
  });

  it('uses a verified subject independently of proxy IP, token rotation and session ID', async () => {
    for (const sid of ['session-1', 'session-2']) {
      const token = jwt.sign({ type: 'access', sub: 'user-1', sid }, { expiresIn: '15m' });
      expect(await tracker(req(token))).toBe('user:user-1');
      expect(await tracker(req(token, '192.0.2.21'))).toBe('user:user-1');
    }
    expect(await tracker(req(jwt.sign({ type: 'access', sub: 'user-2' }, { expiresIn: '15m' })))).toBe('user:user-2');
  });

  it('also isolates media requests using signature-verified employment tokens', async () => {
    expect(await tracker(req(jwt.sign({ type: 'client-employment', sub: 'user-1' }, { expiresIn: '15m' })))).toBe('user:user-1');
  });

  it.each([
    undefined, 'malformed',
    jwt.sign({ type: 'access', sub: 'user-1' }, { secret: 'wrong-secret', expiresIn: '15m' }),
    jwt.sign({ type: 'access', sub: 'user-1' }, { expiresIn: -1 }),
    jwt.sign({ type: 'refresh', sub: 'user-1' }, { expiresIn: '15m' }),
    jwt.sign({ type: 'access', sub: 'user-1' }),
    jwt.sign({ type: 'access', sub: '' }, { expiresIn: '15m' }),
    jwt.sign({ type: 'access', sub: 'user-1' }, { algorithm: 'HS384', expiresIn: '15m' }),
  ])('keeps invalid/untrusted credentials in the normalized IP bucket: %#', async token => {
    expect(await tracker(req(token))).toBe('ip:192.0.2.20');
  });

  it('preserves IPv6 /64 protection for anonymous requests', async () => {
    expect(await tracker(req(undefined, '2001:db8:abcd:12::1')))
      .toBe(await tracker(req(undefined, '2001:db8:abcd:12::ffff')));
  });
});
