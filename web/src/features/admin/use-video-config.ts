import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import {
  CreateMediaVideoProfileDtoSchema, UpdateMediaVideoProfileDtoSchema,
  VerifyMediaVideoProfileDtoSchema, MediaVideoModelDiscoverySchema, MediaVideoProfileVerificationSchema,
  type CreateMediaVideoProfileDto, type UpdateMediaVideoProfileDto, type VerifyMediaVideoProfileDto,
} from 'shared/media-video-config.dto';
import { MediaVideoProfileSchema, type MediaVideoProfile } from 'shared/media-video.dto';

export type { MediaVideoProfile, MediaVideoOperation } from 'shared/media-video.dto';
export type { CreateMediaVideoProfileDto, UpdateMediaVideoProfileDto, MediaVideoModelDiscovery } from 'shared/media-video-config.dto';
export const CreateVideoProfileSchema = CreateMediaVideoProfileDtoSchema;
export const UpdateVideoProfileSchema = UpdateMediaVideoProfileDtoSchema;
export const adminVideoProfilesKey = ['admin', 'video-profiles'] as const;

export function useVideoProfiles() {
  return useQuery({
    queryKey: adminVideoProfilesKey,
    queryFn: async () => MediaVideoProfileSchema.array().parse(await api.get('/admin/media/video/profiles')),
  });
}

function useInvalidateVideo() {
  const client = useQueryClient();
  return () => Promise.all([
    client.invalidateQueries({ queryKey: adminVideoProfilesKey }),
    client.invalidateQueries({
      predicate: ({ queryKey }) => queryKey[0] === 'enterprise'
        && (queryKey[2] === 'video-config' || queryKey[2] === 'available-video-profiles'),
    }),
  ]);
}

export function useCreateVideoProfile() {
  const invalidate = useInvalidateVideo();
  return useMutation({
    mutationFn: (dto: CreateMediaVideoProfileDto) => api.post<MediaVideoProfile>(
      '/admin/media/video/profiles', CreateVideoProfileSchema.parse({ ...dto, enabled: false }),
    ),
    onSuccess: invalidate,
  });
}

export function useUpdateVideoProfile() {
  const invalidate = useInvalidateVideo();
  return useMutation({
    mutationFn: ({ profileId, dto }: { profileId: string; dto: UpdateMediaVideoProfileDto }) => api.patch<MediaVideoProfile>(
      `/admin/media/video/profiles/${encodeURIComponent(profileId)}`, UpdateVideoProfileSchema.parse(dto),
    ),
    onSuccess: invalidate,
  });
}

export function useDiscoverVideoModels() {
  return useMutation({
    mutationFn: async () => MediaVideoModelDiscoverySchema.parse(await api.post('/admin/media/video/models/discover', {})),
  });
}

export function useVerifyVideoProfile() {
  const invalidate = useInvalidateVideo();
  return useMutation({
    mutationFn: async ({ profileId, dto }: { profileId: string; dto: VerifyMediaVideoProfileDto }) => MediaVideoProfileVerificationSchema.parse(
      await api.post(`/admin/media/video/profiles/${encodeURIComponent(profileId)}/verify`, VerifyMediaVideoProfileDtoSchema.parse(dto)),
    ),
    onSuccess: invalidate,
  });
}
