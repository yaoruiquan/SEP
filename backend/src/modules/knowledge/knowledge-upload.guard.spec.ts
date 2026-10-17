import { ExecutionContext, ForbiddenException, NotFoundException } from '@nestjs/common';
import { KnowledgeAccessPolicy } from './knowledge-access-policy';
import { KnowledgeUploadGuard } from './knowledge-upload.guard';

describe('KnowledgeUploadGuard', () => {
  let assertManage: jest.Mock;
  let guard: KnowledgeUploadGuard;
  let context: ExecutionContext;

  beforeEach(() => {
    assertManage = jest.fn().mockResolvedValue(undefined);
    guard = new KnowledgeUploadGuard({ assertManage } as unknown as KnowledgeAccessPolicy);
    context = {
      switchToHttp: () => ({
        getRequest: () => ({
          user: { id: 'authenticated-user' },
          params: { knowledgeBaseId: 'route-kb' },
          body: { userId: 'spoofed-user', knowledgeBaseId: 'spoofed-kb' },
        }),
      }),
    } as unknown as ExecutionContext;
  });

  it('checks management access with the authenticated actor and route knowledge base', async () => {
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(assertManage).toHaveBeenCalledTimes(1);
    expect(assertManage).toHaveBeenCalledWith('authenticated-user', 'route-kb');
  });

  it('does not allow multipart processing while the access check is pending', async () => {
    let allow: () => void;
    assertManage.mockReturnValueOnce(new Promise<void>(resolve => { allow = resolve; }));
    const activated = jest.fn();
    const result = guard.canActivate(context).then(activated);
    await Promise.resolve();
    expect(assertManage).toHaveBeenCalledTimes(1);
    expect(activated).not.toHaveBeenCalled();
    allow!();
    await result;
    expect(activated).toHaveBeenCalledWith(true);
  });

  it.each([
    new ForbiddenException('Management access required'),
    new NotFoundException('Knowledge base unavailable'),
  ])('propagates policy rejection without masking its status: %s', async error => {
    assertManage.mockRejectedValueOnce(error);
    await expect(guard.canActivate(context)).rejects.toBe(error);
  });
});
