'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Cpu } from 'lucide-react';
import { api } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';
import { useEnabledModels } from '@/features/model/use-models';

interface ModelSwitcherProps {
  conversationId: string;
  /** 会话当前模型；null 表示用员工默认 */
  currentModelId: string | null;
  /** 员工默认模型（会话未指定时的兜底显示） */
  employeeModelId?: string | null;
}

/**
 * 对话窗口顶部的模型切换下拉。
 * 切换后 PATCH 会话，后续消息即用新模型。
 */
export function ModelSwitcher({
  conversationId,
  currentModelId,
  employeeModelId,
}: ModelSwitcherProps) {
  const qc = useQueryClient();
  const { data: models, isLoading } = useEnabledModels();

  const switchModel = useMutation({
    mutationFn: (modelId: string) =>
      api.patch(`/conversations/${conversationId}/model`, { modelId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.conversation(conversationId) });
    },
  });

  // 生效模型：会话级 > 员工默认
  const effective = currentModelId ?? employeeModelId ?? '';

  return (
    <div className="flex items-center gap-1.5">
      <Cpu className="h-3.5 w-3.5 text-fg-subtle" />
      <select
        value={effective}
        disabled={isLoading || switchModel.isPending}
        onChange={(e) => switchModel.mutate(e.target.value)}
        className="rounded border border-border bg-background px-2 py-1 text-xs text-fg-muted focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
        title="切换该会话使用的模型"
      >
        {isLoading && <option>加载模型…</option>}
        {!isLoading && (!models || models.length === 0) && (
          <option value="">上游未配置</option>
        )}
        {models?.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
    </div>
  );
}
