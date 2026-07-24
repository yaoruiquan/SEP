'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';
import type { ConversationSession, ConversationDetail } from '@/lib/types';

export function useConversations() {
  return useQuery({
    queryKey: qk.conversations,
    queryFn: () => api.get<ConversationSession[]>('/conversations'),
  });
}

export function useConversation(id: string | null) {
  return useQuery({
    queryKey: qk.conversation(id ?? ''),
    queryFn: () => api.get<ConversationDetail>(`/conversations/${id}`),
    enabled: !!id,
  });
}

export function useCreateConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { employeeId: string; title?: string }) =>
      api.post<ConversationSession>('/conversations', input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.conversations });
    },
  });
}

export function useRenameConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      api.patch<ConversationSession>(`/conversations/${id}`, { title }),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: qk.conversations });
      qc.invalidateQueries({ queryKey: qk.conversation(id) });
    },
  });
}

export function useDeleteConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/conversations/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.conversations });
    },
  });
}
