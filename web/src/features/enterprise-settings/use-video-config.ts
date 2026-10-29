import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import {
  MediaVideoAuthorizationSchema, MediaVideoAvailableProfileSchema, MediaVideoEnterpriseConfigSchema,
  MediaVideoPolicyPreviewRequestSchema, MediaVideoPolicyPreviewSchema, type MediaVideoPolicy,
  type UpdateMediaVideoPolicyDto, type MediaVideoEnterpriseConfig,
} from 'shared/media-video-config.dto';

export type { MediaVideoPolicy, MediaVideoAvailableProfile } from 'shared/media-video-config.dto';
export type { MediaVideoOperation } from 'shared/media-video.dto';
// Old response fields are wire compatibility only; enterprise settings edit models.
export const VideoPolicyFormSchema = MediaVideoAuthorizationSchema.refine(
  policy => !policy.defaultProfileId || policy.enabledProfileIds.includes(policy.defaultProfileId),
  { message: '默认视频模型必须在企业允许列表中', path: ['defaultProfileId'] },
);
export const videoConfigKey = (enterpriseId: string) => ['enterprise', enterpriseId, 'video-config'] as const;
export const availableVideoProfilesKey = (enterpriseId: string) => ['enterprise', enterpriseId, 'available-video-profiles'] as const;

export type EnterpriseVideoConfig = MediaVideoEnterpriseConfig;

export function useEnterpriseVideoConfig(enterpriseId: string) {
  return useQuery({
    queryKey: videoConfigKey(enterpriseId),
    queryFn: async () => MediaVideoEnterpriseConfigSchema.parse(await api.get('/enterprise/media-config/video')),
    enabled: !!enterpriseId,
  });
}

export function useAvailableVideoProfiles(enterpriseId: string) {
  return useQuery({
    queryKey: availableVideoProfilesKey(enterpriseId),
    queryFn: async () => MediaVideoAvailableProfileSchema.array().parse(await api.get('/enterprise/media-config/video/available-profiles')),
    enabled: !!enterpriseId,
    select: (profiles) => profiles.filter((profile) => profile.kind === 'video' && profile.enabled && profile.verified),
  });
}

export function useUpdateEnterpriseVideoConfig(enterpriseId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (dto: UpdateMediaVideoPolicyDto) => api.put<EnterpriseVideoConfig>(
      '/enterprise/media-config/video', MediaVideoAuthorizationSchema.partial().parse(dto),
    ),
    onMutate: () => ({ enterpriseId }),
    onSuccess: (data, _dto, context) => {
      const savedEnterpriseId = context.enterpriseId;
      client.setQueryData(videoConfigKey(savedEnterpriseId), data);
      return client.invalidateQueries({ queryKey: availableVideoProfilesKey(savedEnterpriseId) });
    },
  });
}

export function usePreviewEnterpriseVideoConfig() {
  return useMutation({
    mutationFn: async ({ policy }: { enterpriseId: string; policy: Omit<MediaVideoPolicy, 'periodBudget'> }) => {
      const authorization = MediaVideoAuthorizationSchema.parse(policy);
      const request = MediaVideoPolicyPreviewRequestSchema.parse({ protocolVersion: 3, policy: authorization });
      return MediaVideoPolicyPreviewSchema.parse(await api.post(
        '/enterprise/media-config/video/preview', { ...request, policy: authorization },
      ));
    },
  });
}
