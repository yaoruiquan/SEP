import { ExecutionContext, Injectable } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

/** Set cache policy before JWT evaluation, including unauthenticated JSON errors. */
@Injectable()
export class KnowledgeAuthGuard extends JwtAuthGuard {
  canActivate(context: ExecutionContext) {
    context.switchToHttp().getResponse().setHeader('Cache-Control', 'no-store');
    return super.canActivate(context);
  }
}
