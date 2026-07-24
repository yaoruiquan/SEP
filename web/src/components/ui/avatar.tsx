import { cn } from '@/lib/utils';

interface AvatarProps {
  name?: string | null;
  src?: string | null;
  className?: string;
}

/** Circular avatar; falls back to the first character of the name. */
export function Avatar({ name, src, className }: AvatarProps) {
  const initial = (name?.trim()?.[0] ?? '?').toUpperCase();
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={src}
        alt={name ?? 'avatar'}
        className={cn('rounded-full object-cover', className)}
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
