import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';
import {
  CreateMediaProfileDtoSchema,
  UpdateMediaProfileDtoSchema,
  UpdateMediaConnectionDtoSchema,
  type CreateMediaProfileDto,
  type UpdateMediaProfileDto,
  type UpdateMediaConnectionDto,
  type MediaProfile,
} from '../../../../backend/src/shared/media.dto';

export type { MediaProfile, MediaOperation } from '../../../../backend/src/shared/media.dto';
export { UpdateMediaConnectionDtoSchema };

// Web has no shared alias; reuse the DTOs without dropping their refinements.
export const CreateImageProfileSchema = CreateMediaProfileDtoSchema;
export const UpdateImageProfileSchema = UpdateMediaProfileDtoSchema;
export type CreateImageProfileDto = CreateMediaProfileDto;
export type UpdateImageProfileDto = UpdateMediaProfileDto;

export interface MediaConnection {
  baseUrl: string;
  apiKeyConfigured: boolean;
  configured: boolean;
}

export function useMediaProfiles() {
  return useQuery({
    queryKey: qk.adminMediaProfiles,
    queryFn: () => api.get<MediaProfile[]>('/admin/media/profiles'),
  });
}

export function useMediaConnection() {
  return useQuery({
    queryKey: qk.adminMediaConnection,
    queryFn: () => api.get<MediaConnection>('/admin/media/connection'),
  });
}

function useInvalidateMedia() {
  const client = useQueryClient();
  return () => Promise.all([
    client.invalidateQueries({ queryKey: qk.adminMediaProfiles }),
    client.invalidateQueries({ queryKey: qk.adminMediaConnection }),
    client.invalidateQueries({
      predicate: ({ queryKey }) => queryKey[0] === 'enterprise'
        && (queryKey[2] === 'media-config' || queryKey[2] === 'available-media-profiles'),
    }),
  ]);
}

export function useCreateMediaProfile() {
  const invalidate = useInvalidateMedia();
  return useMutation({
    mutationFn: (dto: CreateImageProfileDto) =>
      api.post<MediaProfile>('/admin/media/profiles', CreateImageProfileSchema.parse({ ...dto, enabled: false })),
    onSuccess: invalidate,
  });
}

export function useUpdateMediaProfile() {
  const invalidate = useInvalidateMedia();
  return useMutation({
    mutationFn: ({ profileId, dto }: { profileId: string; dto: UpdateImageProfileDto }) =>
      api.patch<MediaProfile>(`/admin/media/profiles/${encodeURIComponent(profileId)}`, UpdateImageProfileSchema.parse(dto)),
    onSuccess: invalidate,
  });
}

export function useUpdateMediaConnection() {
  const invalidate = useInvalidateMedia();
  return useMutation({
    mutationFn: (dto: UpdateMediaConnectionDto) => {
      const parsed = UpdateMediaConnectionDtoSchema.parse(dto);
      return api.put<MediaConnection>('/admin/media/connection', {
        baseUrl: parsed.baseUrl,
        ...(parsed.apiKey ? { apiKey: parsed.apiKey } : {}),
      });
    },
    onSuccess: invalidate,
  });
}
