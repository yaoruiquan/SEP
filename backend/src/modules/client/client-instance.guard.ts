import { Injectable, UnauthorizedException } from '@nestjs/common';
import { CanActivate, ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

export interface ClientInstanceClaims {
  sub: string;         // userId
  enterpriseId: string;
  instanceId: string;
  memberId: string;
  type: 'client-instance';
  iat: number;
  exp: number;
}

@Injectable()
export class ClientInstanceGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private config: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const auth = req.headers.authorization as string | undefined;
    if (!auth?.startsWith('Bearer ')) throw new UnauthorizedException('Missing token');

    const token = auth.slice(7);
    const secret = this.config.get('JWT_SECRET') || 'sep-jwt-secret-change-in-production';

    let payload: any;
    try {
      payload = this.jwtService.verify(token, { secret });
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    if (payload.type !== 'client-instance') {
      throw new UnauthorizedException('Token type must be client-instance');
    }

    req.clientInstance = payload as ClientInstanceClaims;
    return true;
  }
}
