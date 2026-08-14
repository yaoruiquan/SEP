'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

export interface KnowledgeBase {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  creator: {
    id: string;
    name: string | null;
    email: string;
  };
  _count: {
    documents: number;
    grants: number;
  };
}

export interface Document {
  id: string;
  filename: string;
  originalName: string;
  fileSize: number;
  mimeType: string;
  status: 'PENDING' | 'READY' | 'FAILED';
  createdAt: string;
  uploader: {
    id: string;
    name: string | null;
    email: string;
  };
}

export interface KnowledgeGrant {
  id: string;
  createdAt: string;
  instance: {
    id: string;
    name: string;
    template: {
      id: string;
      name: string;
    };
  } | null;
  department: {
    id: string;
    name: string;
  } | null;
}

export function useKnowledgeBases() {
  return useQuery<KnowledgeBase[]>({
    queryKey: ['knowledge-bases'],
    queryFn: () => api.get<KnowledgeBase[]>('/knowledge-bases'),
  });
}

export function useKnowledgeBase(id: string | undefined) {
  return useQuery({
    queryKey: ['knowledge-base', id],
    queryFn: () => api.get(`/knowledge-bases/${id}`),
    enabled: !!id,
  });
}

export function useCreateKnowledgeBase() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { name: string; description?: string }) =>
      api.post<KnowledgeBase>('/knowledge-bases', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-bases'] });
    },
  });
}

export function useUpdateKnowledgeBase() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; name?: string; description?: string | null }) =>
      api.patch(`/knowledge-bases/${id}`, data),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-bases'] });
      queryClient.invalidateQueries({ queryKey: ['knowledge-base', vars.id] });
    },
  });
}

export function useDeleteKnowledgeBase() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.delete(`/knowledge-bases/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-bases'] });
    },
  });
}

export function useDocuments(knowledgeBaseId: string | undefined) {
  return useQuery<Document[]>({
    queryKey: ['documents', knowledgeBaseId],
    queryFn: () => api.get<Document[]>(`/knowledge-bases/${knowledgeBaseId}/documents`),
    enabled: !!knowledgeBaseId,
  });
}

export function useUploadDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ knowledgeBaseId, file }: { knowledgeBaseId: string; file: File }) => {
      const formData = new FormData();
      formData.append('file', file);
      return api.post(`/knowledge-bases/${knowledgeBaseId}/documents`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['documents', vars.knowledgeBaseId] });
      queryClient.invalidateQueries({ queryKey: ['knowledge-base', vars.knowledgeBaseId] });
    },
  });
}

export function useDeleteDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ documentId, knowledgeBaseId }: { documentId: string; knowledgeBaseId: string }) =>
      api.delete(`/knowledge-bases/documents/${documentId}`),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['documents', vars.knowledgeBaseId] });
      queryClient.invalidateQueries({ queryKey: ['knowledge-base', vars.knowledgeBaseId] });
    },
  });
}

export function useKnowledgeGrants(knowledgeBaseId: string | undefined) {
  return useQuery<KnowledgeGrant[]>({
    queryKey: ['knowledge-grants', knowledgeBaseId],
    queryFn: () => api.get<KnowledgeGrant[]>(`/knowledge-bases/${knowledgeBaseId}/grants`),
    enabled: !!knowledgeBaseId,
  });
}

export function useCreateGrant() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      knowledgeBaseId,
      ...data
    }: {
      knowledgeBaseId: string;
      subscriptionId?: string;
      departmentId?: string;
    }) =>
      api.post(`/knowledge-bases/${knowledgeBaseId}/grants`, data),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-grants', vars.knowledgeBaseId] });
      queryClient.invalidateQueries({ queryKey: ['knowledge-base', vars.knowledgeBaseId] });
    },
  });
}

export function useDeleteGrant() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ grantId, knowledgeBaseId }: { grantId: string; knowledgeBaseId: string }) =>
      api.delete(`/knowledge-bases/grants/${grantId}`),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-grants', vars.knowledgeBaseId] });
      queryClient.invalidateQueries({ queryKey: ['knowledge-base', vars.knowledgeBaseId] });
    },
  });
}
