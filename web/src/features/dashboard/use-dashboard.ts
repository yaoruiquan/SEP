import { useQuery } from '@tanstack/react-query';
import { fetchDashboardData } from './dashboard-api';

export function useDashboard() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: fetchDashboardData,
    refetchOnWindowFocus: false,
  });
}
