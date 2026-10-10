import 'reflect-metadata';
import { ForbiddenException, HttpStatus, UnauthorizedException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { ThrottlerException, ThrottlerGuard, ThrottlerStorage } from '@nestjs/throttler';
import { THROTTLER_LIMIT, THROTTLER_SKIP, THROTTLER_TTL } from '@nestjs/throttler/dist/throttler.constants';
import { EnterpriseRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { EnterpriseContext, EnterpriseContextService } from '../enterprise/enterprise-context.service';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';

const handlers = ['getCart', 'addToCart', 'updateCartItem', 'removeCartItem', 'clearCart'] as const;

function executionContext(handlerName: typeof handlers[number], header = jest.fn()) {
  return new ExecutionContextHost(
    [{ ip: '127.0.0.1', headers: {} }, { header }],
    CartController,
    CartController.prototype[handlerName],
  );
}

async function throttlingFixture() {
  const hits = new Map<string, number>();
  // Each fixture stays within one controlled minute, without real storage timers.
  const storage = {
    increment: jest.fn<ReturnType<ThrottlerStorage['increment']>, Parameters<ThrottlerStorage['increment']>>(
      async (key, _ttl, limit, _blockDuration, _throttlerName) => {
        const totalHits = (hits.get(key) ?? 0) + 1;
        hits.set(key, totalHits);
        const isBlocked = totalHits > limit;
        return { totalHits, timeToExpire: 60, isBlocked, timeToBlockExpire: isBlocked ? 60 : 0 };
      },
    ),
  };
  const guard = new ThrottlerGuard([
    { name: 'default', ttl: 60000, limit: 100 },
    { name: 'auth', ttl: 60000, limit: 10 },
    { name: 'chat', ttl: 60000, limit: 60 },
  ], storage, new Reflector());
  await guard.onModuleInit();
  return { guard, storage, hits };
}

describe('CartController throttling', () => {
  it('skips auth/chat at class level without overriding default limits', () => {
    expect(Reflect.getMetadata(THROTTLER_SKIP + 'auth', CartController)).toBe(true);
    expect(Reflect.getMetadata(THROTTLER_SKIP + 'chat', CartController)).toBe(true);
    expect(Reflect.getMetadata(THROTTLER_SKIP + 'default', CartController)).not.toBe(true);
    expect(Reflect.getMetadata(THROTTLER_LIMIT + 'default', CartController)).toBeUndefined();
    expect(Reflect.getMetadata(THROTTLER_TTL + 'default', CartController)).toBeUndefined();
  });

  it.each(handlers)('%s uses only default 100/min in the real guard', async handlerName => {
    const { guard, storage } = await throttlingFixture();
    const header = jest.fn();
    await expect(guard.canActivate(executionContext(handlerName, header))).resolves.toBe(true);
    expect(storage.increment).toHaveBeenCalledTimes(1);
    expect(storage.increment).toHaveBeenCalledWith(expect.any(String), 60000, 100, 60000, 'default');
    expect(header).toHaveBeenCalledWith('X-RateLimit-Limit', 100);
  });

  it.each(handlers)('%s allows request 11 from the same IP', async handlerName => {
    const { guard, storage, hits } = await throttlingFixture();
    const context = executionContext(handlerName);
    for (let request = 1; request <= 11; request += 1) {
      await expect(guard.canActivate(context)).resolves.toBe(true);
    }
    expect(storage.increment).toHaveBeenCalledTimes(11);
    expect([...hits.values()]).toEqual([11]);
  });

  it.each(handlers)('%s allows requests 1-100 but rejects request 101 with HTTP 429', async handlerName => {
    const { guard, storage, hits } = await throttlingFixture();
    const header = jest.fn();
    const context = executionContext(handlerName, header);
    for (let request = 1; request <= 100; request += 1) {
      await expect(guard.canActivate(context)).resolves.toBe(true);
    }
    expect(header).toHaveBeenCalledWith('X-RateLimit-Remaining', 0);
    header.mockClear();
    const blocked = guard.canActivate(context);
    await expect(blocked).rejects.toBeInstanceOf(ThrottlerException);
    await expect(blocked).rejects.toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS });
    expect(header).toHaveBeenCalledWith('Retry-After', 60);
    expect(storage.increment).toHaveBeenCalledTimes(101);
    expect([...hits.values()]).toEqual([101]);
    expect(storage.increment.mock.calls.every(call => call[4] === 'default')).toBe(true);
  });

  it.each(handlers)('%s still requires JwtAuthGuard', handlerName => {
    const context = executionContext(handlerName);
    const guards = new Reflector().getAllAndMerge(GUARDS_METADATA, [context.getHandler(), context.getClass()]);
    expect(guards).toContain(JwtAuthGuard);
    const jwtGuard = new JwtAuthGuard();
    expect(() => jwtGuard.handleRequest(null, null, null, context)).toThrow(UnauthorizedException);
    const user = { id: 'user-1' };
    expect(jwtGuard.handleRequest(null, user, null, context)).toBe(user);
  });
});

function controllerFixture(role: EnterpriseRole = EnterpriseRole.ENTERPRISE_ADMIN) {
  const ctx: EnterpriseContext = {
    enterpriseId: 'ent-1', memberId: 'member-1', departmentId: null, role,
  };
  const service = {
    getCart: jest.fn().mockResolvedValue({ items: [], itemCount: 0 }),
    addToCart: jest.fn().mockResolvedValue({ id: 'item-1' }),
    updateCartItem: jest.fn().mockResolvedValue(undefined),
    removeCartItem: jest.fn().mockResolvedValue(undefined),
    clearCart: jest.fn().mockResolvedValue({ deletedCount: 1 }),
  };
  const enterpriseContext = {
    resolve: jest.fn().mockResolvedValue(ctx),
    assertEnterpriseAdmin: jest.fn((context: EnterpriseContext) =>
      EnterpriseContextService.prototype.assertEnterpriseAdmin(context),
    ),
  };
  const controller = new CartController(
    service as unknown as CartService,
    enterpriseContext as unknown as EnterpriseContextService,
  );
  return { controller, service, enterpriseContext, ctx };
}

const req = { user: { id: 'user-1' } };
const addDto = { employeeId: 'employee-1', periodMonths: 12 };
const updateDto = { periodMonths: 6 };
const mutations = [
  {
    name: 'addToCart',
    invoke: (controller: CartController) => controller.addToCart(addDto, req),
    args: ['ent-1', 'user-1', addDto],
  },
  {
    name: 'updateCartItem',
    invoke: (controller: CartController) => controller.updateCartItem('item-1', updateDto, req),
    args: ['ent-1', 'item-1', updateDto],
  },
  {
    name: 'removeCartItem',
    invoke: (controller: CartController) => controller.removeCartItem('item-1', req),
    args: ['ent-1', 'item-1'],
  },
  {
    name: 'clearCart',
    invoke: (controller: CartController) => controller.clearCart(req),
    args: ['ent-1'],
  },
] as const;

describe('CartController enterprise authorization', () => {
  it('allows a member to read only their resolved enterprise cart', async () => {
    const { controller, service, enterpriseContext } = controllerFixture(EnterpriseRole.MEMBER);
    await expect(controller.getCart(req)).resolves.toEqual({ items: [], itemCount: 0 });
    expect(enterpriseContext.resolve).toHaveBeenCalledWith('user-1');
    expect(enterpriseContext.assertEnterpriseAdmin).not.toHaveBeenCalled();
    expect(service.getCart).toHaveBeenCalledWith('ent-1');
  });

  it.each(mutations)('$name preserves administrator checks and authenticated arguments', async ({ name, invoke, args }) => {
    const { controller, service, enterpriseContext, ctx } = controllerFixture();
    await invoke(controller);
    expect(enterpriseContext.resolve).toHaveBeenCalledWith('user-1');
    expect(enterpriseContext.assertEnterpriseAdmin).toHaveBeenCalledWith(ctx);
    expect(service[name]).toHaveBeenCalledTimes(1);
    expect(service[name]).toHaveBeenCalledWith(...args);
  });

  describe.each([EnterpriseRole.MEMBER, EnterpriseRole.DEPT_MANAGER])('%s', role => {
    it.each(mutations)('cannot execute $name or reach its service', async ({ invoke }) => {
      const { controller, service, enterpriseContext, ctx } = controllerFixture(role);
      await expect(invoke(controller)).rejects.toBeInstanceOf(ForbiddenException);
      expect(enterpriseContext.resolve).toHaveBeenCalledWith('user-1');
      expect(enterpriseContext.assertEnterpriseAdmin).toHaveBeenCalledWith(ctx);
      for (const method of Object.values(service)) {
        expect(method).not.toHaveBeenCalled();
      }
    });
  });
});
