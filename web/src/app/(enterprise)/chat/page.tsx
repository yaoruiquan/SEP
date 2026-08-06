'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { MessageSquare } from 'lucide-react';
import { EmptyState } from '@/components/ui/feedback';
import { SessionList } from '@/features/chat/session-list';
import { ChatWindow } from '@/features/chat/chat-window';
import { NewSessionDialog } from '@/features/chat/new-session-dialog';
import {
  useConversations,
  useCreateConversation,
  useDeleteConversation,
  useRenameConversation,
} from '@/features/chat/use-conversations';

export default function ChatPage() {
  const searchParams = useSearchParams();
  const { data: sessions = [], isLoading } = useConversations();
  const createConv = useCreateConversation();
  const renameConv = useRenameConversation();
  const deleteConv = useDeleteConversation();

  // preselect employee from ?employeeId= (e.g. arriving from marketplace)
  const presetEmployee = searchParams.get('employeeId');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  // if arriving with ?employeeId, open the picker automatically once
  const [handledPreset, setHandledPreset] = useState(false);
  if (presetEmployee && !handledPreset) {
    setHandledPreset(true);
    setPickerOpen(true);
  }

  const effectiveActive = activeId ?? sessions[0]?.id ?? null;

  const handleCreate = (employeeId: string) => {
    createConv.mutate(
      { employeeId },
      {
        onSuccess: (conv) => {
          setActiveId(conv.id);
          setPickerOpen(false);
        },
      },
    );
  };

  const handleDelete = (id: string) => {
    deleteConv.mutate(id, {
      onSuccess: () => {
        if (effectiveActive === id) setActiveId(null);
      },
    });
  };

  return (
    <div className="absolute inset-0 flex">
      <SessionList
        sessions={sessions}
        activeId={effectiveActive}
        loading={isLoading}
        onSelect={setActiveId}
        onNew={() => setPickerOpen(true)}
        onRename={(id, title) => renameConv.mutate({ id, title })}
        onDelete={handleDelete}
      />

      <div className="min-w-0 flex-1 flex flex-col">
        {effectiveActive ? (
          <ChatWindow key={effectiveActive} conversationId={effectiveActive} />
        ) : (
          <div className="flex h-full items-center justify-center p-6">
            <EmptyState
              icon={<MessageSquare className="h-8 w-8" />}
              title="选择或新建一个会话"
              description="从左侧选择已有会话，或点击新建会话挑选一位碳基员工开始对话。"
            />
          </div>
        )}
      </div>

      <NewSessionDialog
        open={pickerOpen}
        creating={createConv.isPending}
        presetEmployeeId={presetEmployee}
        onClose={() => setPickerOpen(false)}
        onPick={handleCreate}
      />
    </div>
  );
}
