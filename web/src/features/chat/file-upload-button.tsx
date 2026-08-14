'use client';

import { useRef, type ChangeEvent } from 'react';
import { Paperclip } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FILE_ACCEPT_ATTR } from '@/lib/upload';

interface FileUploadButtonProps {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
}

/**
 * 附件选择按钮。
 *
 * 用原生 `<input type="file">` 而非 react-dropzone：拖放逻辑由 InputBar 的
 * 容器统一处理（见 `useDropZone`），这里只负责点击选择，不值得为此加依赖。
 */
export function FileUploadButton({ onFiles, disabled }: FileUploadButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) onFiles(files);
    // 清空 value：否则选同一个文件两次不会触发 change
    e.target.value = '';
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={FILE_ACCEPT_ATTR}
        onChange={onChange}
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors',
          disabled
            ? 'cursor-not-allowed text-fg-subtle opacity-50'
            : 'text-fg-muted hover:bg-muted hover:text-foreground',
        )}
        aria-label="添加附件"
        title="添加附件（图片 / 文档 / 视频）"
      >
        <Paperclip className="h-[18px] w-[18px]" />
      </button>
    </>
  );
}
