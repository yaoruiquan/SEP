import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import {
  MediaVideoPolicySchema, UpdateMediaVideoPolicyDtoSchema, MediaVideoAvailableProfileSchema, MediaVideoEnterpriseConfigSchema,
  type UpdateMediaVideoPolicyDto, type MediaVideoEnterpriseConfig,
} from 'shared/media-video-config.dto';

export type { MediaVideoPolicy, MediaVideoAvailableProfile } from 'shared/media-video-config.dto';
export type { MediaVideoOperation } from 'shared/media-video.dto';
export const VideoPolicyFormSchema = MediaVideoPolicySchema;
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
      '/enterprise/media-config/video', UpdateMediaVideoPolicyDtoSchema.parse(dto),
    ),
    onMutate: () => ({ enterpriseId }),
    onSuccess: (data, _dto, context) => {
      const savedEnterpriseId = context.enterpriseId;
      client.setQueryData(videoConfigKey(savedEnterpriseId), data);
      return client.invalidateQueries({ queryKey: availableVideoProfilesKey(savedEnterpriseId) });
    },
  });
}
