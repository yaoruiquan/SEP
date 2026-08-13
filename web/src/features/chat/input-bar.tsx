'use client';

import {
  useRef,
  useState,
  useCallback,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from 'react';
import { ArrowUp, Square } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EmployeeSwitcher, type SwitchableEmployee } from './employee-switcher';
import { FilePreview } from './file-preview';
import { FileUploadButton } from './file-upload-button';
import { useAttachmentUpload } from './use-attachment-upload';
import type { MessageAttachment } from '@/lib/types';

interface InputBarProps {
  onSend: (
    text: string,
    targetEmployeeId?: string,
    attachments?: MessageAttachment[],
  ) => void;
  onStop?: () => void;
  streaming?: boolean;
  disabled?: boolean;
  /** 会话默认员工，也是选择器的初始选中项 */
  defaultEmployeeId: string;
  /** 可路由的员工，默认员工应排在首位 */
  employees?: SwitchableEmployee[];
}

export function InputBar({
  onSend,
  onStop,
  streaming,
  disabled,
  defaultEmployeeId,
  employees = [],
}: InputBarProps) {
  const [value, setValue] = useState('');
  const [dragging, setDragging] = useState(false);
  // 拖放进入/离开会在子元素间反复冒泡，用计数器判断是否真的离开了容器
  const dragDepth = useRef(0);
  const attachments = useAttachmentUpload();
  // null = 跟随会话默认员工。存 null 而非直接存 id，是因为 defaultEmployeeId
  // 要等会话请求返回才有值，初始化成空串会让选择器一开始没有选中项。
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const activeEmployeeId = selectedEmployeeId ?? defaultEmployeeId;
  const activeEmployee = employees.find((e) => e.id === activeEmployeeId);

  const autoGrow = useCallback(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, []);

  // 纯附件消息也允许发送（后端 Zod 的 refine 只要求二者不同时为空），
  // 但有文件还在上传时必须等 —— 否则那些附件会被漏掉。
  const canSend =
    (value.trim().length > 0 || attachments.ready.length > 0) &&
    !attachments.uploading &&
    !streaming &&
    !disabled;

  const submit = useCallback(() => {
    const text = value.trim();
    if (!canSend) return;
    // 选择保持不变：连续追问同一位员工是主要用法，每条都要重选很别扭
    onSend(
      text,
      activeEmployeeId || undefined,
      attachments.ready.length > 0 ? attachments.ready : undefined,
    );
    setValue('');
    attachments.clear();
    requestAnimationFrame(() => {
      if (taRef.current) taRef.current.style.height = 'auto';
    });
  }, [value, canSend, activeEmployeeId, onSend, attachments]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  /** 截图直接 Ctrl+V 是最高频的图片输入方式，不能只靠选择文件 */
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData?.files ?? []);
    if (files.length > 0) {
      e.preventDefault();
      attachments.addFiles(files);
    }
  };

  const onDragEnter = (e: DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  };

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    // 不 preventDefault 的话 drop 不会触发，浏览器会直接打开文件
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const onDragLeave = () => {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (disabled) return;
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length > 0) attachments.addFiles(files);
  };

  return (
    <div
      className="relative flex-shrink-0 border-t border-border bg-background px-4 py-3"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary bg-primary/5">
          <p className="text-sm font-medium text-primary">松开以添加附件</p>
        </div>
      )}

      <div className="mx-auto max-w-3xl">
        <EmployeeSwitcher
          employees={employees}
          activeId={activeEmployeeId}
          onSelect={setSelectedEmployeeId}
          disabled={streaming || disabled}
        />

        <FilePreview items={attachments.items} onRemove={attachments.remove} />

        <div className="flex items-end gap-1 rounded-2xl border border-border bg-white px-2 py-2 shadow-sm focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-brand-ring">
          <FileUploadButton
            onFiles={attachments.addFiles}
            disabled={disabled || streaming}
          />
          <textarea
            ref={taRef}
            rows={1}
            value={value}
            disabled={disabled}
            placeholder={
              activeEmployee
                ? `给 ${activeEmployee.name} 发消息…（Enter 发送，Shift+Enter 换行）`
                : '给你的硅基员工发消息…（Enter 发送，Shift+Enter 换行）'
            }
            onChange={(e) => {
              setValue(e.target.value);
              autoGrow();
            }}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            className="max-h-[200px] flex-1 resize-none bg-transparent py-1.5 text-[15px] leading-relaxed outline-none placeholder:text-fg-subtle disabled:opacity-50 scroll-thin"
          />
          {streaming ? (
            <button
              type="button"
              onClick={onStop}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-foreground transition-colors hover:bg-border"
              aria-label="停止生成"
            >
              <Square className="h-4 w-4 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!canSend}
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors',
                canSend
                  ? 'bg-primary text-primary-foreground hover:bg-primary-hover'
                  : 'bg-muted text-fg-subtle',
              )}
              aria-label="发送"
              title={attachments.uploading ? '附件上传中…' : '发送'}
            >
              <ArrowUp className="h-5 w-5" />
            </button>
          )}
        </div>

        <div className="mt-1 flex items-start gap-2 px-1 text-[11px]">
          {attachments.limitError && (
            <span className="text-danger">{attachments.limitError}</span>
          )}
          {attachments.uploading && !attachments.limitError && (
            <span className="text-fg-subtle">附件上传中，稍候即可发送…</span>
          )}
          {value.length > 0 && (
            <span className="ml-auto shrink-0 text-fg-subtle">{value.length} 字</span>
          )}
        </div>
      </div>
    </div>
  );
}
