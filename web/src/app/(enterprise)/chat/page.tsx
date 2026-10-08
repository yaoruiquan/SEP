'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { MessageSquare } from 'lucide-react';
import { EmptyState } from '@/components/ui/feedback';
import { toast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api-client';
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

  // 历史会话可能关联已下架员工；优先打开仍可用的会话，避免进入页面就被旧会话卡住。
  const defaultSessionId =
    sessions.find((session) => session.employee?.status !== 'ARCHIVED')?.id ??
    sessions[0]?.id ??
    null;
  const effectiveActive = activeId ?? defaultSessionId;

  const handleCreate = (employeeId: string) => {
    createConv.mutate(
      { employeeId },
      {
        onSuccess: (conv) => {
          setActiveId(conv.id);
          setPickerOpen(false);
        },
        /*
          没有这个分支时，创建失败的表现是「点了开始对话，什么都不发生」——
          弹窗不关、没有提示、按钮的 loading 转一下就恢复。而后端在这条路上有三种
          明确的拒绝理由（员工不存在 / 无有效雇佣 / 算力与个人余额都见底），
          全被吞掉了。线上就是这么表现的：按钮像坏了，其实后端每次都回了原因。
        */
        onError: (error) =>
          toast.error(
            error instanceof ApiError || error instanceof Error
              ? error.message
              : '创建会话失败，请稍后重试',
          ),
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
    <div className="flex h-full min-h-0 overflow-hidden">
      <SessionList
        sessions={sessions}
        activeId={effectiveActive}
        loading={isLoading}
        onSelect={setActiveId}
        onNew={() => setPickerOpen(true)}
        onRename={(id, title) => renameConv.mutate({ id, title })}
        onDelete={handleDelete}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {effectiveActive ? (
          <ChatWindow
            key={effectiveActive}
            conversationId={effectiveActive}
            onNewSession={() => setPickerOpen(true)}
          />
        ) : (
          <div className="flex h-full items-center justify-center p-6">
            <EmptyState
              icon={<MessageSquare className="h-8 w-8" />}
              title="选择或新建一个会话"
              description="从左侧选择已有会话，或点击新建会话挑选一位硅基员工开始对话。"
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
