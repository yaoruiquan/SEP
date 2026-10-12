import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { useAuthStore } from '@/lib/auth-store';
import {
  RestoreModelRuntimePolicyDtoSchema,
  UpdateModelRuntimePolicyDtoSchema,
  type ModelRuntimePolicyAdminView,
  type ModelRuntimePolicyHistoryPage,
  type ModelRuntimePolicyWriteResult,
  type RestoreModelRuntimePolicyDto,
  type UpdateModelRuntimePolicyDto,
} from '../../../../backend/src/shared/model-runtime-policy';

export type {
  ModelRuntimePolicyAdminView,
  ModelRuntimePolicyFieldView,
  ModelRuntimePolicyHistoryItem,
  ModelRuntimePolicyHistoryPage,
  ModelRuntimePolicyKey,
} from '../../../../backend/src/shared/model-runtime-policy';

const path = '/settings/model-runtime-policy';
export const modelRuntimePolicyQueryKey = ['settings', 'model-runtime-policy'] as const;

export function useModelRuntimePolicy() {
  const isAdmin = useAuthStore((state) => state.user?.role === 'ADMIN');
  return useQuery({
    queryKey: modelRuntimePolicyQueryKey,
    queryFn: () => api.get<ModelRuntimePolicyAdminView>(path),
    enabled: isAdmin,
    retry: false,
  });
}

export function useModelRuntimePolicyHistory(cursor?: string, enabled = true) {
  const isAdmin = useAuthStore((state) => state.user?.role === 'ADMIN');
  return useQuery({
    queryKey: [...modelRuntimePolicyQueryKey, 'history', cursor ?? ''],
    queryFn: () => {
      const params = new URLSearchParams({ limit: '20' });
      if (cursor) params.set('cursor', cursor);
      return api.get<ModelRuntimePolicyHistoryPage>(`${path}/history?${params}`);
    },
    enabled: enabled && isAdmin,
    retry: false,
  });
}

function usePolicyWritten() {
  const client = useQueryClient();
  return (result: ModelRuntimePolicyWriteResult) => {
    client.setQueryData(modelRuntimePolicyQueryKey, result);
    void client.invalidateQueries({ queryKey: [...modelRuntimePolicyQueryKey, 'history'] });
    void client.invalidateQueries({ queryKey: ['settings'], exact: true });
  };
}

export function useUpdateModelRuntimePolicy() {
  const onSuccess = usePolicyWritten();
  return useMutation({
    mutationFn: (dto: UpdateModelRuntimePolicyDto) =>
      api.put<ModelRuntimePolicyWriteResult>(path, UpdateModelRuntimePolicyDtoSchema.parse(dto)),
    onSuccess,
  });
}

export function useRestoreModelRuntimePolicy() {
  const onSuccess = usePolicyWritten();
  return useMutation({
    mutationFn: (dto: RestoreModelRuntimePolicyDto) =>
      api.post<ModelRuntimePolicyWriteResult>(`${path}/restore`, RestoreModelRuntimePolicyDtoSchema.parse(dto)),
    onSuccess,
  });
}
