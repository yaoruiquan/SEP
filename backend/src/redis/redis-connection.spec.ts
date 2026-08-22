import { parseRedisUrl, resolveRedisOptions } from './redis-connection';

describe('Redis connection configuration', () => {
  it('parses host, credentials, and database from REDIS_URL', () => {
    expect(parseRedisUrl('redis://user:p%40ss@longdao-redis:6380/1')).toEqual({
      host: 'longdao-redis',
      port: 6380,
      username: 'user',
      password: 'p@ss',
      db: 1,
    });
  });

  it('supports TLS URLs', () => {
    expect(parseRedisUrl('rediss://cache.example/2')).toEqual({
      host: 'cache.example',
      port: 6379,
      db: 2,
      tls: {},
    });
  });

  it('falls back to legacy variables when REDIS_URL is invalid', () => {
    const get = <T>(key: string, fallback?: T): T =>
      ({ REDIS_URL: 'not-a-url', REDIS_HOST: 'redis', REDIS_PORT: '6381', REDIS_DB: '3' }[key] ?? fallback) as T;

    expect(resolveRedisOptions({ get })).toEqual({
      host: 'redis',
      port: 6381,
      db: 3,
    });
  });

  it('defaults to localhost without a URL', () => {
    const get = <T>(_key: string, fallback?: T): T => fallback as T;
    expect(resolveRedisOptions({ get })).toEqual({ host: 'localhost', port: 6379 });
  });
});
