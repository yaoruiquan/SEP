import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';
import {
  MediaPolicySchema,
  UpdateMediaPolicyDtoSchema,
  type MediaPolicy,
  type MediaAvailableProfile,
  type UpdateMediaPolicyDto,
} from '../../../../backend/src/shared/media.dto';

export type { MediaPolicy, MediaAvailableProfile, MediaOperation } from '../../../../backend/src/shared/media.dto';

export const MediaPolicyFormSchema = MediaPolicySchema.extend({
  allowedOperations: UpdateMediaPolicyDtoSchema.shape.allowedOperations.unwrap(),
}).refine((policy) => !policy.defaultProfileId || policy.enabledProfileIds.includes(policy.defaultProfileId), {
  message: '默认图片配置必须在企业允许列表中', path: ['defaultProfileId'],
});

export interface EnterpriseMediaConfig {
  policy: MediaPolicy;
  configured: boolean;
  canEdit: boolean;
}

export function useEnterpriseMediaConfig(enterpriseId: string) {
  return useQuery({
    queryKey: qk.mediaConfig(enterpriseId),
    queryFn: () => api.get<EnterpriseMediaConfig>('/enterprise/media-config'),
    enabled: !!enterpriseId,
  });
}

export function useAvailableMediaProfiles(enterpriseId: string) {
  return useQuery({
    queryKey: qk.availableMediaProfiles(enterpriseId),
    queryFn: () => api.get<MediaAvailableProfile[]>('/enterprise/media-config/available-profiles'),
    enabled: !!enterpriseId,
    select: (profiles) => profiles.filter((profile) => profile.kind === 'image' && profile.enabled && profile.verified),
  });
}

export function useUpdateEnterpriseMediaConfig(enterpriseId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (dto: UpdateMediaPolicyDto) =>
      api.put<EnterpriseMediaConfig>('/enterprise/media-config', UpdateMediaPolicyDtoSchema.parse(dto)),
    onSuccess: (data) => {
      client.setQueryData(qk.mediaConfig(enterpriseId), data);
      return client.invalidateQueries({ queryKey: qk.availableMediaProfiles(enterpriseId) });
    },
  });
}
