import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import {
  CreateMediaVideoProfileDtoSchema, UpdateMediaVideoProfileDtoSchema,
  VerifyMediaVideoProfileDtoSchema, MediaVideoModelDiscoverySchema, MediaVideoProfileVerificationSchema,
  type CreateMediaVideoProfileDto, type UpdateMediaVideoProfileDto, type VerifyMediaVideoProfileDto,
} from 'shared/media-video-config.dto';
import { MediaVideoProfileSchema, type MediaVideoProfile } from 'shared/media-video.dto';
import { UpdateMediaConnectionDtoSchema, type UpdateMediaConnectionDto } from 'shared/media.dto';

export type { MediaVideoProfile, MediaVideoOperation } from 'shared/media-video.dto';
export type { CreateMediaVideoProfileDto, UpdateMediaVideoProfileDto, MediaVideoModelDiscovery } from 'shared/media-video-config.dto';
export const CreateVideoProfileSchema = CreateMediaVideoProfileDtoSchema;
export const UpdateVideoProfileSchema = UpdateMediaVideoProfileDtoSchema;
export const adminVideoProfilesKey = ['admin', 'video-profiles'] as const;
export const adminVideoConnectionKey = ['admin', 'video-connection'] as const;

export interface MediaVideoConnection {
  baseUrl: string;
  apiKeyConfigured: boolean;
  configured: boolean;
  source?: 'database' | 'environment' | 'unconfigured';
}

export function useVideoConnection() {
  return useQuery({
    queryKey: adminVideoConnectionKey,
    queryFn: () => api.get<MediaVideoConnection>('/admin/media/video/connection'),
  });
}

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
    client.invalidateQueries({ queryKey: adminVideoConnectionKey }),
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
  const invalidate = useInvalidateVideo();
  return useMutation({
    mutationFn: async () => MediaVideoModelDiscoverySchema.parse(await api.post('/admin/media/video/models/discover', {})),
    onSuccess: invalidate,
  });
}

export function useUpdateVideoConnection() {
  const invalidate = useInvalidateVideo();
  return useMutation({
    mutationFn: (dto: UpdateMediaConnectionDto) => {
      const parsed = UpdateMediaConnectionDtoSchema.parse(dto);
      return api.put<MediaVideoConnection>('/admin/media/video/connection', {
        baseUrl: parsed.baseUrl, ...(parsed.apiKey ? { apiKey: parsed.apiKey } : {}),
      });
    },
    onSuccess: invalidate,
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
