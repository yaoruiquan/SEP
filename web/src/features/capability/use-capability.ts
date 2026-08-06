import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

/**
 * 下载 SKILL 类型能力包
 */
export function useDownloadSkill() {
  return useMutation({
    mutationFn: async (capabilityId: string) => {
      const response = await apiClient.get(`/capabilities/${capabilityId}/download`, {
        responseType: 'blob',
      });

      // 从响应头获取文件名
      const contentDisposition = response.headers['content-disposition'];
      let filename = `skill_${capabilityId}.zip`;

      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
        if (filenameMatch && filenameMatch[1]) {
          filename = decodeURIComponent(filenameMatch[1].replace(/['"]/g, ''));
        }
      }

      // 创建下载链接
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);

      return { filename };
    },
  });
}
