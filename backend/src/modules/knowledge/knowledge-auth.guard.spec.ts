import { UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { KnowledgeAuthGuard } from './knowledge-auth.guard';

describe('KnowledgeAuthGuard cache policy', () => {
  afterEach(() => jest.restoreAllMocks());
  it('sets no-store before JWT rejection so 401 responses cannot be cached', () => {
    const setHeader = jest.fn();
    const context = { switchToHttp: () => ({ getResponse: () => ({ setHeader }) }) } as any;
    jest.spyOn(JwtAuthGuard.prototype, 'canActivate').mockImplementation(() => {
      expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
      throw new UnauthorizedException();
    });
    expect(() => new KnowledgeAuthGuard().canActivate(context)).toThrow(UnauthorizedException);
  });
});
