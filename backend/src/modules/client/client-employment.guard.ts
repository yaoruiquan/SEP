import { Injectable, UnauthorizedException } from '@nestjs/common';
import { CanActivate, ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

export interface ClientEmploymentClaims {
  sub: string;         // userId
  enterpriseId: string;
  subscriptionId: string;
  memberId: string;
  type: 'client-employment';
  iat: number;
  exp: number;
}

@Injectable()
export class ClientEmploymentGuard implements CanActivate {
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

    if (payload.type !== 'client-employment') {
      throw new UnauthorizedException('Token type must be client-employment');
    }

    req.clientEmployment = payload as ClientEmploymentClaims;
    return true;
  }
}
