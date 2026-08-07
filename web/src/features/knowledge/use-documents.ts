import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, uploadForm } from '@/lib/api-client';

interface Document {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  fileSize: number;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  createdAt: string;
  updatedAt: string;
  uploader: {
    id: string;
    name: string | null;
    email: string;
  };
}

/**
 * 获取知识库的文档列表
 */
export function useDocuments(knowledgeBaseId: string | null) {
  return useQuery<Document[]>({
    queryKey: ['documents', knowledgeBaseId],
    queryFn: async () => {
      if (!knowledgeBaseId) throw new Error('No knowledge base ID');
      const data = await api.get<Document[]>(`/knowledge/${knowledgeBaseId}/documents`);
      return data;
    },
    enabled: !!knowledgeBaseId,
  });
}

/**
 * 获取单个文档详情
 */
export function useDocument(knowledgeBaseId: string | null, documentId: string | null) {
  return useQuery<Document>({
    queryKey: ['documents', knowledgeBaseId, documentId],
    queryFn: async () => {
      if (!knowledgeBaseId || !documentId) throw new Error('Missing IDs');
      const data = await api.get<Document>(
        `/knowledge/${knowledgeBaseId}/documents/${documentId}`
      );
      return data;
    },
    enabled: !!knowledgeBaseId && !!documentId,
  });
}

/**
 * 上传文档
 */
export function useUploadDocument(knowledgeBaseId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return await uploadForm<Document>(
        `/knowledge/${knowledgeBaseId}/documents/upload`,
        formData
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents', knowledgeBaseId] });
      queryClient.invalidateQueries({ queryKey: ['knowledge-bases', knowledgeBaseId] });
    },
  });
}

/**
 * 删除文档
 */
export function useDeleteDocument(knowledgeBaseId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (documentId: string) => {
      await api.delete(`/knowledge/${knowledgeBaseId}/documents/${documentId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents', knowledgeBaseId] });
      queryClient.invalidateQueries({ queryKey: ['knowledge-bases', knowledgeBaseId] });
    },
  });
}

/**
 * 下载文档
 */
export function downloadDocument(knowledgeBaseId: string, documentId: string) {
  // 直接用浏览器下载，因为有认证
  window.open(`/api/knowledge/${knowledgeBaseId}/documents/${documentId}/download`, '_blank');
}
