'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';
import type { DigitalEmployee } from '@/lib/types';

export function useEmployees(status?: string) {
  const params = status ? { status } : {};
  return useQuery({
    queryKey: qk.employees(params),
    queryFn: () => {
      const qs = status ? `?status=${encodeURIComponent(status)}` : '';
      return api.get<DigitalEmployee[]>(`/digital-employees${qs}`);
    },
  });
}

export function usePublishedEmployees() {
  return useEmployees('PUBLISHED');
}

export function useEmployee(id: string | undefined) {
  return useQuery({
    queryKey: qk.employee(id ?? ''),
    queryFn: () => api.get<DigitalEmployee>(`/digital-employees/${id}`),
    enabled: !!id,
  });
}
