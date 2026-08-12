'use client';

import { useRef, useState, useCallback, type KeyboardEvent } from 'react';
import { ArrowUp, Square, AtSign, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';

interface InputBarProps {
  onSend: (text: string, targetEmployeeId?: string) => void;
  onStop?: () => void;
  streaming?: boolean;
  disabled?: boolean;
  placeholder?: string;
  defaultEmployeeId: string; // 会话默认员工
  defaultEmployeeName: string;
  availableEmployees?: Array<{ id: string; name: string; avatar: string | null }>; // 可切换的员工列表
}

export function InputBar({
  onSend,
  onStop,
  streaming,
  disabled,
  placeholder = '给你的碳基员工发消息…（Enter 发送，Shift+Enter 换行）',
  defaultEmployeeId,
  defaultEmployeeName,
  availableEmployees = [],
}: InputBarProps) {
  const [value, setValue] = useState('');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const autoGrow = useCallback(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, []);

  const submit = useCallback(() => {
    const text = value.trim();
    if (!text || streaming || disabled) return;
    onSend(text, selectedEmployeeId ?? undefined);
    setValue('');
    setSelectedEmployeeId(null); // 发送后重置员工选择
    requestAnimationFrame(() => {
      if (taRef.current) taRef.current.style.height = 'auto';
    });
  }, [value, streaming, disabled, selectedEmployeeId, onSend]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const targetEmployee = availableEmployees.find((e) => e.id === selectedEmployeeId);
  const showEmployeeSelector = availableEmployees.length > 1; // 多于1个员工时才显示选择器

  return (
    <div className="border-t border-border bg-background px-4 py-3">
      {/* 🆕 员工选择器（多员工协作） */}
      {showEmployeeSelector && (
        <div className="mx-auto mb-2 flex max-w-3xl items-center gap-2">
          <Select
            value={selectedEmployeeId ?? defaultEmployeeId}
            onValueChange={(val) =>
              setSelectedEmployeeId(val === defaultEmployeeId ? null : val)
            }
          >
            <SelectTrigger className="w-48">
              <SelectValue placeholder="选择员工" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={defaultEmployeeId}>
                {selectedEmployeeId === null && '✓ '}
                {defaultEmployeeName}
              </SelectItem>
              {availableEmployees
                .filter((e) => e.id !== defaultEmployeeId)
                .map((emp) => (
                  <SelectItem key={emp.id} value={emp.id}>
                    {selectedEmployeeId === emp.id && '✓ '}
                    {emp.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>

          {targetEmployee && (
            <Badge variant="default" className="gap-1 bg-muted text-foreground">
              <AtSign className="h-3 w-3" />
              {targetEmployee.name}
              <button
                onClick={() => setSelectedEmployeeId(null)}
                className="ml-1 rounded-full hover:bg-muted"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}

          <span className="text-xs text-fg-subtle">
            {targetEmployee
              ? `本条消息将由 ${targetEmployee.name} 处理`
              : `当前员工：${defaultEmployeeName}`}
          </span>
        </div>
      )}

      <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-border bg-white px-3 py-2 shadow-sm focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-brand-ring">
        <textarea
          ref={taRef}
          rows={1}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => {
            setValue(e.target.value);
            autoGrow();
          }}
          onKeyDown={onKeyDown}
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
            disabled={!value.trim() || disabled}
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors',
              value.trim() && !disabled
                ? 'bg-primary text-primary-foreground hover:bg-primary-hover'
                : 'bg-muted text-fg-subtle',
            )}
            aria-label="发送"
          >
            <ArrowUp className="h-5 w-5" />
          </button>
        )}
      </div>
      {value.length > 0 && (
        <div className="mx-auto mt-1 max-w-3xl px-1 text-right text-[11px] text-fg-subtle">
          {value.length} 字
        </div>
      )}
    </div>
  );
}
