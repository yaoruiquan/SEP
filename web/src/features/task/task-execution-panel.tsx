'use client';

import { X, CheckCircle, XCircle, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Markdown } from '@/features/chat/markdown';
import type { StreamState } from '@/features/chat/use-chat-stream';

interface TaskExecutionPanelProps {
  open: boolean;
  taskId: string;
  taskTitle: string;
  stream: StreamState;
  onClose: () => void;
  onStop: () => void;
}

export function TaskExecutionPanel({
  open,
  taskId,
  taskTitle,
  stream,
  onClose,
  onStop,
}: TaskExecutionPanelProps) {
  if (!open) return null;

  const { text, reasoning, toolCalls, streaming, error } = stream;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={() => !streaming && onClose()}
      />
      <div className="relative z-10 w-full max-w-4xl max-h-[85vh] overflow-hidden rounded-xl border border-border bg-white shadow-md flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5 shrink-0">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <h3 className="text-base font-semibold text-foreground truncate">
              {taskTitle}
            </h3>
            {streaming && (
              <Badge className="bg-blue-500 text-white flex items-center gap-1 shrink-0">
                <Loader2 className="h-3 w-3 animate-spin" />
                执行中
              </Badge>
            )}
            {error && (
              <Badge className="bg-red-500 text-white flex items-center gap-1 shrink-0">
                <XCircle className="h-3 w-3" />
                失败
              </Badge>
            )}
            {!streaming && !error && text && (
              <Badge className="bg-green-500 text-white flex items-center gap-1 shrink-0">
                <CheckCircle className="h-3 w-3" />
                已完成
              </Badge>
            )}
          </div>
          <button
            type="button"
            onClick={() => !streaming && onClose()}
            className="rounded p-1 text-fg-subtle hover:bg-muted shrink-0"
            aria-label="关闭"
            disabled={streaming}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 scroll-thin">
          {/* Tool Calls */}
          {toolCalls.length > 0 && (
            <Card className="p-4">
              <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-blue-500" />
                执行步骤
              </h4>
              <div className="space-y-2">
                {toolCalls.map((tool, idx) => (
                  <div key={idx} className="flex items-center gap-3 text-sm">
                    <div className="flex items-center justify-center w-6 h-6 rounded-full bg-muted text-fg-muted font-medium text-xs shrink-0">
                      {idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-foreground">{tool.name}</span>
                      {tool.capabilityId && (
                        <span className="text-fg-muted ml-2">#{tool.capabilityId.slice(0, 8)}</span>
                      )}
                    </div>
                    <div className="shrink-0">
                      {tool.status === 'running' && (
                        <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                      )}
                      {tool.status === 'done' && tool.success && (
                        <div className="flex items-center gap-1 text-green-600">
                          <CheckCircle className="h-4 w-4" />
                          {tool.durationMs && (
                            <span className="text-xs">{(tool.durationMs / 1000).toFixed(1)}s</span>
                          )}
                        </div>
                      )}
                      {tool.status === 'done' && tool.success === false && (
                        <XCircle className="h-4 w-4 text-red-500" />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* 推理过程 (如果有) */}
          {reasoning && (
            <Card className="p-4 bg-amber-50 border-amber-200">
              <h4 className="text-sm font-medium mb-2 text-amber-900">推理过程</h4>
              <div className="text-sm text-amber-800 whitespace-pre-wrap font-mono">
                {reasoning}
              </div>
            </Card>
          )}

          {/* 输出内容 */}
          {text && (
            <Card className="p-4">
              <h4 className="text-sm font-medium mb-3">输出结果</h4>
              <div className="prose prose-sm max-w-none">
                <Markdown content={text} />
              </div>
              {streaming && (
                <div className="flex items-center gap-2 mt-3 text-xs text-fg-subtle">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  生成中...
                </div>
              )}
            </Card>
          )}

          {/* 错误信息 */}
          {error && (
            <Card className="p-4 bg-red-50 border-red-200">
              <div className="flex items-start gap-3">
                <XCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-sm font-medium text-red-900 mb-1">执行失败</h4>
                  <p className="text-sm text-red-800">{error}</p>
                </div>
              </div>
            </Card>
          )}

          {/* 初始加载状态 */}
          {!text && !error && streaming && toolCalls.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-blue-500 mb-3" />
              <p className="text-sm text-fg-muted">正在初始化任务...</p>
            </div>
          )}
        </div>

        {/* 底部操作 */}
        <div className="flex items-center justify-between border-t border-border px-5 py-3 shrink-0">
          <div className="text-xs text-fg-subtle">
            任务 ID: {taskId}
          </div>
          <div className="flex gap-2">
            {streaming && (
              <Button size="sm" variant="secondary" onClick={onStop}>
                终止任务
              </Button>
            )}
            {!streaming && (
              <Button size="sm" onClick={onClose}>
                关闭
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
