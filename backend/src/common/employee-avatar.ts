import { ServiceUnavailableException } from '@nestjs/common';
import type { EmployeeAvatarAsset } from '../shared/employee-avatar';
import registry from './employee-avatar-assets.json';
import { readAvatarBindings } from './avatar-style';

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

export function withEmployeeAvatar<T extends { id: string; avatar: string | null; avatarStyle?: string | null; avatarBindings?: unknown }>(
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

  // Registered future styles may provide a separately cropped face image.
  // Match the persisted current portrait so inactive bindings cannot change the result.
  const bindings = Object.entries(readAvatarBindings(employee.avatarBindings));
  const matchesCurrent = (portrait: string, version?: string | null) => {
    if (portrait === raw) return true;
    if (!portrait.startsWith('/') || portrait.startsWith('//')) return false;
    const expected = new URL(portrait, employeeAssetBaseUrl());
    if (version) expected.searchParams.set('v', version);
    return expected.href === raw;
  };
  const matching = employee.avatarStyle === 'custom' ? undefined
    : bindings.find(([style, binding]) => style === employee.avatarStyle && matchesCurrent(binding.portraitUrl, binding.version))
      ?? bindings.find(([, binding]) => matchesCurrent(binding.portraitUrl, binding.version));
  if (matching && (matching[1].faceUrl || matching[1].version)) {
    const [style, binding] = matching;
    const resolve = (value: string) => {
      try {
        const isRelative = value.startsWith('/') && !value.startsWith('//');
        const image = isRelative ? new URL(value, employeeAssetBaseUrl()) : new URL(value);
        if (!['http:', 'https:'].includes(image.protocol) || image.username || image.password) return null;
        // Leave external (possibly signed) URLs intact. Relative platform assets can be versioned.
        if (isRelative && binding.version) image.searchParams.set('v', binding.version);
        return image.href;
      } catch (error) {
        if (error instanceof ServiceUnavailableException) throw error;
        return null;
      }
    };
    const portraitUrl = resolve(binding.portraitUrl);
    const faceUrl = binding.faceUrl ? resolve(binding.faceUrl) : portraitUrl;
    if (portraitUrl && faceUrl) return {
      ...employee,
      avatar: portraitUrl,
      avatarAsset: { id: `employee:${employee.id}:${style}`, version: binding.version ?? null, portraitUrl, faceUrl },
    };
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
