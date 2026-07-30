import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/feedback';

interface StatsCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  loading?: boolean;
}

export function StatsCard({ title, value, icon, loading }: StatsCardProps) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-6">
        <div className="flex-1">
          <p className="text-sm text-fg-muted">{title}</p>
          {loading ? (
            <Skeleton className="mt-2 h-8 w-20" />
          ) : (
            <p className="mt-1 text-3xl font-bold text-foreground">{value}</p>
          )}
        </div>
        <div className="text-4xl text-primary opacity-20">{icon}</div>
      </CardContent>
    </Card>
  );
}
