import { useMutation } from '@tanstack/react-query';
import { downloadFile } from '@/lib/api-client';

/**
 * 下载 SKILL 类型能力包
 */
export function useDownloadSkill() {
  return useMutation({
    mutationFn: async (capabilityId: string) => {
      return downloadFile(`/capabilities/${capabilityId}/download`);
    },
  });
}
