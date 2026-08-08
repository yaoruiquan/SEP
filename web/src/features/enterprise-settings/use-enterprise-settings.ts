import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import type {
  EnterpriseSettingView,
  UpdateEnterpriseSettingDto,
  CustomRoleView,
  CreateCustomRoleDto,
  UpdateCustomRoleDto,
  AssignCustomRoleDto,
  ApiKeyView,
  CreateApiKeyDto,
  CreateApiKeyResponse,
  ApiCallLogQueryDto,
} from '../../../../backend/src/shared/enterprise-settings.dto';

// Re-export types for pages to consume
export type {
  EnterpriseSettingView,
  CustomRoleView,
  ApiKeyView,
  CreateApiKeyResponse,
};

// ─────────────────────────────────────────────────────────────────────────────
// Enterprise Setting
// ─────────────────────────────────────────────────────────────────────────────

export function useEnterpriseSetting() {
  return useQuery<EnterpriseSettingView>({
    queryKey: ['enterprise', 'settings'],
    queryFn: () => api.get('/enterprise/settings'),
  });
}

export function useUpdateEnterpriseSetting() {
  const qc = useQueryClient();
  return useMutation<EnterpriseSettingView, Error, UpdateEnterpriseSettingDto>({
    mutationFn: (dto) => api.put('/enterprise/settings', dto),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['enterprise', 'settings'] });
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Custom Roles
// ─────────────────────────────────────────────────────────────────────────────

export function useCustomRoles() {
  return useQuery<CustomRoleView[]>({
    queryKey: ['enterprise', 'roles'],
    queryFn: () => api.get('/enterprise/roles'),
  });
}

export function useCreateCustomRole() {
  const qc = useQueryClient();
  return useMutation<CustomRoleView, Error, CreateCustomRoleDto>({
    mutationFn: (dto) => api.post('/enterprise/roles', dto),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['enterprise', 'roles'] });
    },
  });
}

export function useUpdateCustomRole() {
  const qc = useQueryClient();
  return useMutation<CustomRoleView, Error, { roleId: string; dto: UpdateCustomRoleDto }>({
    mutationFn: ({ roleId, dto }) => api.put(`/enterprise/roles/${roleId}`, dto),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['enterprise', 'roles'] });
    },
  });
}

export function useDeleteCustomRole() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (roleId) => api.delete(`/enterprise/roles/${roleId}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['enterprise', 'roles'] });
    },
  });
}

export function useAssignCustomRole() {
  const qc = useQueryClient();
  return useMutation<void, Error, { memberId: string; dto: AssignCustomRoleDto }>({
    mutationFn: ({ memberId, dto }) =>
      api.patch(`/enterprise/roles/members/${memberId}/assign`, dto),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['enterprise', 'members'] });
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// API Keys
// ─────────────────────────────────────────────────────────────────────────────

export function useApiKeys() {
  return useQuery<ApiKeyView[]>({
    queryKey: ['enterprise', 'api-keys'],
    queryFn: () => api.get('/enterprise/api-keys'),
  });
}

export function useCreateApiKey() {
  const qc = useQueryClient();
  return useMutation<CreateApiKeyResponse, Error, CreateApiKeyDto>({
    mutationFn: (dto) => api.post('/enterprise/api-keys', dto),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['enterprise', 'api-keys'] });
    },
  });
}

export function useRevokeApiKey() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (keyId) => api.delete(`/enterprise/api-keys/${keyId}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['enterprise', 'api-keys'] });
    },
  });
}

export function useApiCallLogs(query: Partial<ApiCallLogQueryDto> = {}) {
  return useQuery({
    queryKey: ['enterprise', 'api-keys', 'call-logs', query],
    queryFn: () =>
      api.get(`/enterprise/api-keys/call-logs?${new URLSearchParams(query as Record<string, string>).toString()}`),
  });
}
