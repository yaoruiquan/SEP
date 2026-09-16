import { ServiceUnavailableException } from '@nestjs/common';
import type { EmployeeAvatarAsset } from '../shared/employee-avatar';
import registry from './employee-avatar-assets.json';

type AssetRecord = { id: string; version: string; portraitPath: string; facePath: string };
const assets: Record<string, AssetRecord> = registry;

/** Static assets are served by the web origin, not the Nest API origin. */
export function employeeAssetBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  // Local .env can contain a production FRONTEND_URL for payment callbacks.
  // Only an explicit asset origin should override local development assets.
  const value = env.ASSET_BASE_URL?.trim() ||
    (env.NODE_ENV === 'production' ? env.FRONTEND_URL?.trim() : 'http://localhost:3000');
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
      throw new Error('Expected an HTTP(S) origin');
    }
    return url.origin;
  } catch {
    throw new ServiceUnavailableException('ASSET_BASE_URL must be the public HTTP(S) origin serving /assets');
  }
}

export function withEmployeeAvatar<T extends { id: string; avatar: string | null }>(
  employee: T,
): T & { avatarAsset: EmployeeAvatarAsset | null } {
  const raw = employee.avatar?.trim();
  if (!raw) return { ...employee, avatar: null, avatarAsset: null };

  const relative = raw.startsWith('/') && !raw.startsWith('//');
  let url: URL;
  try {
    url = relative ? new URL(raw, employeeAssetBaseUrl()) : new URL(raw);
  } catch (error) {
    if (error instanceof ServiceUnavailableException) throw error;
    return { ...employee, avatar: null, avatarAsset: null };
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    return { ...employee, avatar: null, avatarAsset: null };
  }

  // Only our own registered assets have derivatives. Never rewrite third-party URLs.
  const registered = assets[url.pathname];
  const owned = registered && (relative || url.origin === employeeAssetBaseUrl());
  if (owned) {
    const versionedUrl = (path: string) => {
      const result = new URL(path, employeeAssetBaseUrl());
      result.searchParams.set('v', registered.version);
      return result.href;
    };
    const avatarAsset = {
      id: registered.id,
      version: registered.version,
      portraitUrl: versionedUrl(registered.portraitPath),
      faceUrl: versionedUrl(registered.facePath),
    };
    return { ...employee, avatar: avatarAsset.portraitUrl, avatarAsset };
  }

  const avatar = relative ? url.href : raw;
  return {
    ...employee,
    avatar,
    avatarAsset: { id: `employee:${employee.id}:avatar`, version: null, portraitUrl: avatar, faceUrl: avatar },
  };
}
