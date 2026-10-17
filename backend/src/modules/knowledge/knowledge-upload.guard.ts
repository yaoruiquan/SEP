import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { KnowledgeAccessPolicy } from './knowledge-access-policy';

/** Run before multipart consumption, not only after the file is received. */
@Injectable()
export class KnowledgeUploadGuard implements CanActivate {
  constructor(private readonly policy: KnowledgeAccessPolicy) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    await this.policy.assertManage(req.user.id, req.params.knowledgeBaseId);
    return true;
  }
}
