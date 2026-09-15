'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * 半身图默认焦点偏上，保证圆形裁切时头部完整、不被肩部顶出画框。
 * 素材本身是「头顶到大腿」的满幅构图，圆心取在 22% 高度最稳。
 */
const DEFAULT_FOCAL = '50% 22%';

/**
 * 硅基员工素材按用途派生两个变体：
 *   <slug>.webp       512px 完整半身（大尺寸展示，保留服装和姿态）
 *   <slug>-face.webp  256px 头部特写（42-96px 的圆形头像，脸不会被缩没）
 * 这里按文件名约定切换，调用方不用关心 CDN 路径细节。
 */
function toFaceVariant(src: string): string {
  if (!/\.webp(\?.*)?$/i.test(src)) return src;
  if (/-face\.webp(\?.*)?$/i.test(src)) return src;
  return src.replace(/\.webp(\?.*)?$/i, '-face.webp$1');
}

interface AvatarProps {
  name?: string | null;
  src?: string | null;
  className?: string;
  /**
   * 硅基员工半身照传 true：默认切头部特写变体，适合圆形/圆角头像。
   * 碳基员工大头照或普通头像保持默认即可。
   */
  portrait?: boolean;
  /**
   * 展示完整半身照（大尺寸、身份区、宣传位）时传 true。
   * 仅在 portrait 生效的前提下有意义。
   */
  fullBody?: boolean;
  /** CSS object-position 覆盖默认焦点，用于个别构图偏移的素材。 */
  focalPoint?: string;
}

/**
 * 统一头像组件。
 *
 * - 有图：object-cover + 焦点偏移；加载失败自动回落首字母，不留碎图。
 * - 无图：姓名首字母 + 品牌色底，保证列表不出现空洞。
 */
export function Avatar({
  name,
  src,
  className,
  portrait = false,
  fullBody = false,
  focalPoint,
}: AvatarProps) {
  const initial = (name?.trim()?.[0] ?? '?').toUpperCase();
  const raw = src?.trim() ?? '';
  const faceUrl = raw && portrait && !fullBody ? toFaceVariant(raw) : '';
  const [failed, setFailed] = useState(false);
  const [faceFailed, setFaceFailed] = useState(false);

  // src 变了就重新给一次机会，否则换人后仍停在上一张的首字母占位
  useEffect(() => {
    setFailed(false);
    setFaceFailed(false);
  }, [raw]);

  // 优先特写；特写缺失时退回母版半身图；母版也失败才落到首字母占位
  const url = faceUrl && !faceFailed ? faceUrl : raw;

  if (url && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={name ?? 'avatar'}
        loading="lazy"
        decoding="async"
        onError={() => {
          if (url === faceUrl && raw) setFaceFailed(true);
          else setFailed(true);
        }}
        style={{ objectPosition: focalPoint ?? (portrait ? DEFAULT_FOCAL : '50% 50%') }}
        className={cn('rounded-full bg-glass-2 object-cover', className)}
      />
    );
  }

  return (
    <div
      className={cn(
        'flex items-center justify-center rounded-full bg-primary-subtle font-semibold text-primary',
        className,
      )}
    >
      {initial}
    </div>
  );
}
