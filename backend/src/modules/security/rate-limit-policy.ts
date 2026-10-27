import type { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { normalizeIp } from '@nestjs/throttler';
import type { Request } from 'express';
import { THROTTLER_LIMIT, THROTTLER_SKIP, THROTTLER_TTL } from '@nestjs/throttler/dist/throttler.constants';

const reflector = new Reflector();

/** Named policies are opt-in. New ordinary controllers need no skip decorators. */
export function skipUnselectedRule(name: 'auth' | 'chat', context: ExecutionContext): boolean {
  const targets = [context.getHandler(), context.getClass()];
  if (reflector.getAllAndOverride<boolean>(THROTTLER_SKIP + name, targets) === false) return false;
  return reflector.getAllAndOverride(THROTTLER_LIMIT + name, targets) === undefined &&
    reflector.getAllAndOverride(THROTTLER_TTL + name, targets) === undefined;
}

/**
 * Global throttling runs before route authentication. Verify the signature and
 * expiry here; never trust req.user, decoded JWTs or caller-supplied identity/IP
 * headers. This selects a budget only: route guards still authorize every call.
 */
export function businessTracker(config: ConfigService, jwt: JwtService): (req: Pick<Request, 'headers' | 'ip'>) => Promise<string> {
  return async req => {
    const authorization = req.headers?.authorization;
    const bearer = typeof authorization === 'string' ? /^Bearer\s+(\S+)$/i.exec(authorization)?.[1] : undefined;
    const secret = config.get<string>('ACCESS_JWT_SECRET') ?? config.get<string>('JWT_SECRET');
    if (bearer && secret) {
      try {
        const claims = await jwt.verifyAsync<{ sub?: unknown; type?: unknown; exp?: unknown }>(bearer, {
          secret, algorithms: ['HS256'],
        });
        if (typeof claims.sub === 'string' && claims.sub.length > 0 &&
          typeof claims.exp === 'number' &&
          (claims.type === 'access' || claims.type === 'client-employment')) {
          return `user:${claims.sub}`;
        }
      } catch {
        // Invalid credentials share the IP abuse bucket; authentication remains
        // the responsibility of JwtAuthGuard / ClientEmploymentGuard.
      }
    }
    return `ip:${normalizeIp(req.ip)}`;
  };
}
