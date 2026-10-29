import { BadRequestException } from '@nestjs/common';
import {
  FOLLOW_DEFAULT_STYLE_ID,
  SILICON_3D_STYLE,
  canonicalAvatarStyleId,
  generateSeedFromName,
  builtinAvatarStyle,
  BUILTIN_AVATAR_STYLES,
  libraryAvatarBinding,
} from '../shared/dicebear-styles';
import avatarRegistry from './employee-avatar-assets.json';

export const DEFAULT_AVATAR_STYLE_ID = SILICON_3D_STYLE.id;

type EmployeeAvatarInput = {
  id: string;
  name: string;
  position: string;
  avatar: string | null;
  avatarStyle?: string | null;
  avatarCustomUrl?: string | null;
  avatarBindings?: unknown;
};

export type AvatarBinding = { portraitUrl: string; faceUrl?: string | null; version?: string | null };
export type AvatarBindings = Record<string, AvatarBinding>;


export function isKnownAvatarStyle(styleId: string): boolean {
  return !!builtinAvatarStyle(styleId);
}

export function requireKnownAvatarStyle(styleId: string): string {
  const canonical = canonicalAvatarStyleId(styleId);
  if (!isKnownAvatarStyle(canonical)) {
    throw new BadRequestException(`头像风格 ${styleId} 不存在`);
  }
  return canonical;
}

export function inferAvatarStyle(avatar: string | null, stored?: string | null): string {
  if (stored) return canonicalAvatarStyleId(stored);
  if (avatar?.startsWith('/assets/employees/silicon/')) return SILICON_3D_STYLE.id;
  const local = avatar?.match(/\/avatar-library\/v\d+\/([^/]+)\/([^/?]+)/);
  if (local) {
    const style = BUILTIN_AVATAR_STYLES.find((style) => style.source === local[1] && style.styleId === local[2]);
    if (style) return style.id;
  }
  const dicebear = avatar?.match(/^https:\/\/api\.dicebear\.com\/(?:\d+\.x\/)?([^/]+)\/svg\?/);
  return dicebear ? `cartoon:${dicebear[1]}` : 'custom';
}

export function platformAvatarPath(employee: EmployeeAvatarInput): string | null {
  if (employee.avatar?.startsWith('/assets/employees/silicon/') && avatarRegistry[employee.avatar as keyof typeof avatarRegistry]) {
    return employee.avatar;
  }
  return null;
}

export function readAvatarBindings(value: unknown): AvatarBindings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, item]) => {
    return !!item && typeof item === 'object' && typeof (item as AvatarBinding).portraitUrl === 'string';
  })) as AvatarBindings;
}

export function bindingForStyle(employee: EmployeeAvatarInput, styleId: string): AvatarBinding | null {
  const canonical = canonicalAvatarStyleId(styleId);
  return readAvatarBindings(employee.avatarBindings)[canonical] ?? null;
}

export function resolveAvatarForStyle(employee: EmployeeAvatarInput, styleId: string): string | null {
  return resolveAvatarBindingForStyle(employee, styleId)?.portraitUrl ?? null;
}

export function resolveAvatarBindingForStyle(employee: EmployeeAvatarInput, styleId: string): AvatarBinding | null {
  const canonical = canonicalAvatarStyleId(styleId);
  const binding = bindingForStyle(employee, canonical);
  if (binding) return binding;
  if (canonical === SILICON_3D_STYLE.id) {
    const path = platformAvatarPath(employee);
    return path ? { portraitUrl: path } : null;
  }
  if (!isKnownAvatarStyle(canonical)) return null;
  const seed = generateSeedFromName(employee.id);
  return libraryAvatarBinding(canonical, seed, employee.name);
}

export function employeeEffectiveStyle(stored: string | null | undefined, defaultStyle: string): string {
  const inferred = stored || FOLLOW_DEFAULT_STYLE_ID;
  return inferred === FOLLOW_DEFAULT_STYLE_ID ? defaultStyle : canonicalAvatarStyleId(inferred);
}

/** Preserve the current image before a switch; never infer a different person's 3D image. */
export function preservedAvatarBindings(employee: EmployeeAvatarInput): AvatarBindings {
  const bindings = readAvatarBindings(employee.avatarBindings);
  if (employee.avatar) {
    const inferred = inferAvatarStyle(employee.avatar);
    if (inferred !== 'custom') bindings[inferred] ??= { portraitUrl: employee.avatar };
    if (employee.avatarStyle && !['custom', FOLLOW_DEFAULT_STYLE_ID].includes(employee.avatarStyle)) {
      bindings[canonicalAvatarStyleId(employee.avatarStyle)] ??= { portraitUrl: employee.avatar };
    }
  }
  return bindings;
}

export function isAvatarImageUrl(value: string): boolean {
  if (value.startsWith('/assets/') && !/[\\\s?#]/.test(value) && !value.split('/').includes('..')) return true;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}
