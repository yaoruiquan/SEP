/**
 * StatCard Component - Enhanced statistics card with icon, trend, and optional mini chart
 *
 * Usage:
 * <StatCard
 *   label="硅基员工"
 *   value={16}
 *   icon={Users}
 *   trend="+12%"
 *   trendUp={true}
 * />
 */

import { LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface StatCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  trend?: string;
  trendUp?: boolean;
  description?: string;
  className?: string;
  onClick?: () => void;
}

export function StatCard({
  label,
  value,
  icon: Icon,
  trend,
  trendUp,
  description,
  className,
  onClick,
}: StatCardProps) {
  return (
    <Card
      className={cn(
        'hover:shadow-md transition-all duration-200',
        onClick && 'cursor-pointer hover:-translate-y-0.5',
        className
      )}
      onClick={onClick}
    >
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div className="space-y-2 flex-1">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-fg-muted">{label}</p>
              {trend && (
                <Badge
                  variant="default"
                  className={cn(
                    'text-xs font-normal',
                    trendUp
                      ? 'bg-success/10 text-success hover:bg-success/20'
                      : 'bg-muted text-fg-muted hover:bg-muted/80'
                  )}
                >
                  {trend}
                </Badge>
              )}
            </div>

            <p className="text-3xl font-bold text-foreground">{value}</p>

            {description && (
              <p className="text-xs text-fg-subtle">{description}</p>
            )}
          </div>

          <div className="rounded-full bg-primary/10 p-3 ml-4">
            <Icon className="h-6 w-6 text-primary" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
