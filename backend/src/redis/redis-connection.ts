import type { RedisOptions } from 'ioredis';

export interface RedisConfigSource {
  get<T>(propertyPath: string, defaultValue?: T): T;
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Parse a redis:// or rediss:// URL into options shared by all Redis clients. */
export function parseRedisUrl(value: string): RedisOptions | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') {
      return undefined;
    }

    const options: RedisOptions = {
      host: url.hostname,
      port: Number.parseInt(url.port || '6379', 10),
    };

    if (!Number.isFinite(options.port) || options.port <= 0) {
      return undefined;
    }

    const db = url.pathname.replace(/^\//, '');
    if (db) {
      const parsedDb = Number.parseInt(db, 10);
      if (!Number.isInteger(parsedDb) || parsedDb < 0) {
        return undefined;
      }
      options.db = parsedDb;
    }

    if (url.username) options.username = decode(url.username);
    if (url.password) options.password = decode(url.password);
    if (url.protocol === 'rediss:') options.tls = {};

    return options;
  } catch {
    return undefined;
  }
}

/** Resolve Redis configuration, preferring REDIS_URL over legacy variables. */
export function resolveRedisOptions(config: RedisConfigSource): RedisOptions {
  const url = config.get<string>('REDIS_URL');
  const fromUrl = url ? parseRedisUrl(url) : undefined;
  if (fromUrl) return fromUrl;

  const port = Number.parseInt(config.get<string>('REDIS_PORT', '6379'), 10);
  const options: RedisOptions = {
    host: config.get<string>('REDIS_HOST', 'localhost'),
    port: Number.isFinite(port) && port > 0 ? port : 6379,
  };

  const username = config.get<string>('REDIS_USERNAME');
  const password = config.get<string>('REDIS_PASSWORD');
  const db = config.get<string>('REDIS_DB');
  if (username) options.username = username;
  if (password) options.password = password;
  if (db !== undefined && db !== '') {
    const parsedDb = Number.parseInt(db, 10);
    if (Number.isInteger(parsedDb) && parsedDb >= 0) options.db = parsedDb;
  }

  return options;
}
