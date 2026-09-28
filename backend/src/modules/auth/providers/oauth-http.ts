import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';

export type OAuthFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export async function getJson<T>(fetcher: OAuthFetch, url: string): Promise<T> {
  let response: Response;
  try {
    response = await fetcher(url, { headers: { Accept: 'application/json' } });
  } catch {
    throw new ServiceUnavailableException('第三方登录服务暂时不可用');
  }
  if (!response.ok) throw new ServiceUnavailableException('第三方登录服务暂时不可用');
  try {
    return (await response.json()) as T;
  } catch {
    throw new BadRequestException('第三方登录响应无效');
  }
}

export async function getText(fetcher: OAuthFetch, url: string): Promise<string> {
  let response: Response;
  try {
    response = await fetcher(url, { headers: { Accept: 'text/plain, application/json' } });
  } catch {
    throw new ServiceUnavailableException('第三方登录服务暂时不可用');
  }
  if (!response.ok) throw new ServiceUnavailableException('第三方登录服务暂时不可用');
  return response.text();
}

export function requireProviderValue(value: string | undefined, message: string): string {
  if (!value) throw new ServiceUnavailableException(message);
  return value;
}
