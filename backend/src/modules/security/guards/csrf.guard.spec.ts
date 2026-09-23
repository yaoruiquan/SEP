import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CsrfGuard } from './csrf.guard';

describe('CsrfGuard', () => {
  let guard: CsrfGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    process.env.CORS_ORIGIN = 'https://example.com,https://app.example.com';
    process.env.NODE_ENV = 'production';
    guard = new CsrfGuard(reflector);
  });

  const createMockContext = (method: string, path: string, headers: Record<string, string> = {}): ExecutionContext => {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          method,
          path,
          headers,
        }),
      }),
    } as ExecutionContext;
  };

  describe('幂等方法（GET/HEAD/OPTIONS）', () => {
    it('应该放行 GET 请求', () => {
      const context = createMockContext('GET', '/api/users');
      expect(guard.canActivate(context)).toBe(true);
    });

    it('应该放行 HEAD 请求', () => {
      const context = createMockContext('HEAD', '/api/users');
      expect(guard.canActivate(context)).toBe(true);
    });

    it('应该放行 OPTIONS 请求', () => {
      const context = createMockContext('OPTIONS', '/api/users');
      expect(guard.canActivate(context)).toBe(true);
    });
  });

  describe('健康检查端点', () => {
    it('应该放行 /health', () => {
      const context = createMockContext('POST', '/health');
      expect(guard.canActivate(context)).toBe(true);
    });

    it('应该放行 /api/health', () => {
      const context = createMockContext('POST', '/api/health');
      expect(guard.canActivate(context)).toBe(true);
    });
  });

  describe('CSRF 保护（POST/PUT/DELETE）', () => {
    it('来自允许源的 POST 请求应该通过', () => {
      const context = createMockContext('POST', '/api/users', {
        origin: 'https://example.com',
      });
      expect(guard.canActivate(context)).toBe(true);
    });

    it('配置域名含大写字母时应匹配浏览器规范化的小写 Origin', () => {
      process.env.CORS_ORIGIN = 'https://longdaoSEP.cn';
      guard = new CsrfGuard(reflector);
      const context = createMockContext('POST', '/api/auth/login', {
        origin: 'https://longdaosep.cn',
      });
      expect(guard.canActivate(context)).toBe(true);
    });

    it('配置中的默认端口应与浏览器 Origin 匹配', () => {
      process.env.CORS_ORIGIN = 'https://EXAMPLE.com:443/';
      guard = new CsrfGuard(reflector);
      const context = createMockContext('POST', '/api/users', {
        origin: 'https://example.com',
      });
      expect(guard.canActivate(context)).toBe(true);
    });

    it('来自允许源的 Referer 应该通过', () => {
      const context = createMockContext('POST', '/api/users', {
        referer: 'https://app.example.com/dashboard',
      });
      expect(guard.canActivate(context)).toBe(true);
    });

    it('来自未授权源应该抛出 ForbiddenException', () => {
      const context = createMockContext('POST', '/api/users', {
        origin: 'https://evil.com',
      });
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('相似但不同的域名不能通过', () => {
      const context = createMockContext('POST', '/api/users', {
        origin: 'https://example.com.evil.com',
      });
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('无效 Origin 应拒绝而不是返回服务器错误', () => {
      const context = createMockContext('POST', '/api/users', {
        origin: 'not-a-url',
      });
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('带 Bearer 凭证的原生客户端模型请求无需 Origin，由客户端鉴权 Guard 验签', () => {
      const context = createMockContext('POST', '/api/gateway/v1/chat/completions', {
        authorization: 'Bearer employment-token',
      });
      expect(guard.canActivate(context)).toBe(true);
    });

    it('模型接口无 Bearer 凭证时仍拒绝无 Origin 的请求', () => {
      const context = createMockContext('POST', '/api/gateway/v1/chat/completions');
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('其他接口带 Bearer 凭证也不能跳过 CSRF 来源校验', () => {
      const context = createMockContext('POST', '/api/auth/logout', {
        authorization: 'Bearer employment-token',
      });
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('生产环境客户端认证接口无 Origin/Referer 应该放行', () => {
      for (const path of [
        '/api/client/auth/login',
        '/api/client/auth/refresh',
        '/api/client/auth/token',
      ]) {
        const context = createMockContext('POST', path);
        expect(guard.canActivate(context)).toBe(true);
      }
    });

    it('客户端认证放行不应扩大到其他客户端写接口', () => {
      const context = createMockContext('POST', '/api/client/employees');
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('生产环境缺少 Origin/Referer 应该抛出异常', () => {
      const context = createMockContext('POST', '/api/users');
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });
  });

  describe('开发环境', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'development';
      guard = new CsrfGuard(reflector);
    });

    it('应该放行 localhost 源', () => {
      const context = createMockContext('POST', '/api/users', {
        origin: 'http://localhost:3000',
      });
      expect(guard.canActivate(context)).toBe(true);
    });

    it('缺少 Origin/Referer 应该放行', () => {
      const context = createMockContext('POST', '/api/users');
      expect(guard.canActivate(context)).toBe(true);
    });
  });
});
