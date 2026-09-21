'use client';

import { LucideIcon } from 'lucide-react';
import { CardContainer, CardBody, CardItem } from '@/components/aceternity/3d-card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface StatCard3DProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  trend?: string;
  trendUp?: boolean;
  description?: string;
  className?: string;
  onClick?: () => void;
}

export function StatCard3D({
  label,
  value,
  icon: Icon,
  trend,
  trendUp,
  description,
  className,
  onClick,
}: StatCard3DProps) {
  return (
    <CardContainer className="w-full" containerClassName={cn('w-full', onClick && 'cursor-pointer')}>
      <CardBody
        className={cn(
          'glass-card group relative h-full w-full p-6',
          'hover:border-glassline-brand transition-all duration-300',
          className,
        )}
        onClick={onClick}
      >
        <div className="flex items-center justify-between">
          <div className="flex-1 space-y-2">
            <div className="flex items-center justify-between">
              <CardItem
                translateZ="30"
                className="text-sm font-medium text-gtext-secondary"
              >
                {label}
              </CardItem>
              {trend && (
                <CardItem translateZ="40">
                  <Badge
                    variant="default"
                    className={cn(
                      'text-xs font-normal backdrop-blur-sm',
                      trendUp
                        ? 'bg-gsuccess/10 text-gsuccess border-gsuccess/20'
                        : 'bg-glass-2 text-gtext-muted border-glassline',
                    )}
                  >
                    {trend}
                  </Badge>
                </CardItem>
              )}
            </div>

            <CardItem
              translateZ="50"
              className="text-3xl font-bold text-gtext-primary"
            >
              {value}
            </CardItem>

            {description && (
              <CardItem
                translateZ="30"
                className="text-xs text-gtext-muted"
              >
                {description}
              </CardItem>
            )}
          </div>

          <CardItem
            translateZ="60"
            rotateZ={-5}
            className="ml-4"
          >
            <div className="rounded-full bg-gbrand/10 p-3 backdrop-blur-sm border border-glassline group-hover:border-glassline-brand group-hover:shadow-glow-brand transition-all duration-300">
              <Icon className="h-6 w-6 text-gbrand-text" />
            </div>
          </CardItem>
        </div>
      </CardBody>
    </CardContainer>
  );
}
