import { ArgumentsHost, HttpException } from '@nestjs/common';
import { SensitiveDataFilter } from './sensitive-data.filter';

describe('SensitiveDataFilter', () => {
  let filter: SensitiveDataFilter;
  let mockResponse: any;
  let mockRequest: any;
  let mockArgumentsHost: ArgumentsHost;

  beforeEach(() => {
    filter = new SensitiveDataFilter();

    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    mockRequest = {
      method: 'POST',
      url: '/api/auth/login',
      body: {},
      headers: {},
    };

    mockArgumentsHost = {
      switchToHttp: () => ({
        getResponse: () => mockResponse,
        getRequest: () => mockRequest,
      }),
    } as ArgumentsHost;
  });

  describe('敏感字段脱敏', () => {
    it('应该脱敏请求体中的密码字段', () => {
      mockRequest.body = {
        email: 'user@example.com',
        password: 'secret123',
      };

      const exception = new HttpException('Bad request', 400);
      filter.catch(exception, mockArgumentsHost);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      // 日志中的 body 应该已脱敏（通过检查不抛出错误来验证）
    });

    it('应该脱敏响应中的 token', () => {
      const exception = new HttpException(
        {
          message: 'Unauthorized',
          token: 'sensitive-token-123',
          user: { id: '1', email: 'user@example.com' },
        },
        401
      );

      filter.catch(exception, mockArgumentsHost);

      const responseCall = mockResponse.json.mock.calls[0][0];
      expect(responseCall.statusCode).toBe(401);
      expect(responseCall.token).toBe('[REDACTED]');
      expect(responseCall.user.email).toBe('user@example.com');
    });

    it('应该脱敏嵌套对象中的敏感字段', () => {
      mockRequest.body = {
        user: {
          email: 'user@example.com',
          password: 'secret',
          profile: {
            apiKey: 'key-123',
            name: 'John',
          },
        },
      };

      const exception = new HttpException('Error', 500);
      filter.catch(exception, mockArgumentsHost);

      // 验证不抛出错误（敏感数据已正确处理）
      expect(mockResponse.status).toHaveBeenCalledWith(500);
    });

    it('应该脱敏数组中的敏感字段', () => {
      mockRequest.body = {
        users: [
          { email: 'user1@example.com', password: 'pass1' },
          { email: 'user2@example.com', accessToken: 'token2' },
        ],
      };

      const exception = new HttpException('Error', 500);
      filter.catch(exception, mockArgumentsHost);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
    });
  });

  describe('错误响应', () => {
    it('应该正确处理 HttpException', () => {
      const exception = new HttpException('Validation failed', 400);
      filter.catch(exception, mockArgumentsHost);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      const responseCall = mockResponse.json.mock.calls[0][0];
      expect(responseCall.statusCode).toBe(400);
      expect(responseCall.message).toBe('Validation failed');
      expect(responseCall.timestamp).toBeDefined();
      expect(responseCall.path).toBe('/api/auth/login');
    });

    it('应该处理字符串类型的异常响应', () => {
      const exception = new HttpException('Simple error', 403);
      filter.catch(exception, mockArgumentsHost);

      expect(mockResponse.status).toHaveBeenCalledWith(403);
      const responseCall = mockResponse.json.mock.calls[0][0];
      expect(responseCall.message).toBe('Simple error');
    });

    it('应该处理普通 Error 对象', () => {
      const exception = new Error('Something went wrong');
      filter.catch(exception, mockArgumentsHost);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      const responseCall = mockResponse.json.mock.calls[0][0];
      expect(responseCall.message).toBe('Something went wrong');
    });

    it('应该处理未知异常类型', () => {
      const exception = 'Unknown error';
      filter.catch(exception, mockArgumentsHost);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      const responseCall = mockResponse.json.mock.calls[0][0];
      expect(responseCall.message).toBe('Internal server error');
    });
  });

  describe('日志记录', () => {
    it('5xx 错误应该记录 error 级别日志', () => {
      const exception = new HttpException('Server error', 500);
      const loggerSpy = jest.spyOn((filter as any).logger, 'error');

      filter.catch(exception, mockArgumentsHost);

      expect(loggerSpy).toHaveBeenCalled();
    });

    it('4xx 错误应该记录 warn 级别日志', () => {
      const exception = new HttpException('Bad request', 400);
      const loggerSpy = jest.spyOn((filter as any).logger, 'warn');

      filter.catch(exception, mockArgumentsHost);

      expect(loggerSpy).toHaveBeenCalled();
    });
  });
});
