import { cn } from '@/lib/utils';

type EmployeeStatus = 'online' | 'busy' | 'offline';

interface StatusDotProps {
  status: EmployeeStatus;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  animated?: boolean;
  className?: string;
}

const sizeClasses = {
  sm: 'w-2 h-2',
  md: 'w-3 h-3',
  lg: 'w-4 h-4',
};

const statusConfig = {
  online: {
    color: 'bg-status-online',
    label: '在线',
    ring: 'ring-status-online/20',
  },
  busy: {
    color: 'bg-status-busy',
    label: '忙碌',
    ring: 'ring-status-busy/20',
  },
  offline: {
    color: 'bg-status-offline',
    label: '离线',
    ring: 'ring-status-offline/20',
  },
};

export function StatusDot({
  status,
  size = 'md',
  showLabel = false,
  animated = true,
  className,
}: StatusDotProps) {
  const config = statusConfig[status];

  return (
    <div className={cn('inline-flex items-center gap-1.5', className)}>
      <span
        className={cn(
          'rounded-full',
          sizeClasses[size],
          config.color,
          animated && status === 'online' && 'animate-pulse-slow',
          animated && 'ring-2 ring-offset-1',
          animated && config.ring
        )}
        aria-label={config.label}
      />
      {showLabel && (
        <span className="text-sm text-neutral-600">{config.label}</span>
      )}
    </div>
  );
}
