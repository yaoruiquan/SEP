'use client';

import { useCallback, useState } from 'react';
import { Upload, X, FileText, AlertCircle, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useUploadDocument } from './use-documents';
import { cn } from '@/lib/utils';

interface DocumentUploaderProps {
  knowledgeBaseId: string;
  onUploadComplete?: () => void;
}

interface FileWithProgress {
  file: File;
  progress: number;
  status: 'pending' | 'uploading' | 'success' | 'error';
  error?: string;
}

export function DocumentUploader({ knowledgeBaseId, onUploadComplete }: DocumentUploaderProps) {
  const [files, setFiles] = useState<FileWithProgress[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const uploadMutation = useUploadDocument(knowledgeBaseId);

  const acceptedTypes = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'text/plain',
    'text/markdown',
  ];

  const acceptedExtensions = '.pdf,.doc,.docx,.txt,.md';

  const handleFiles = useCallback((newFiles: FileList | null) => {
    if (!newFiles) return;

    const fileArray = Array.from(newFiles);
    const validFiles = fileArray.filter((file) => {
      // 检查文件类型
      if (!acceptedTypes.includes(file.type) && !file.name.match(/\.(pdf|doc|docx|txt|md)$/i)) {
        return false;
      }
      // 检查文件大小（10MB）
      if (file.size > 10 * 1024 * 1024) {
        return false;
      }
      return true;
    });

    const filesWithProgress: FileWithProgress[] = validFiles.map((file) => ({
      file,
      progress: 0,
      status: 'pending',
    }));

    setFiles((prev) => [...prev, ...filesWithProgress]);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const uploadFiles = async () => {
    for (let i = 0; i < files.length; i++) {
      const fileWithProgress = files[i];
      if (fileWithProgress.status !== 'pending') continue;

      // 更新状态为上传中
      setFiles((prev) =>
        prev.map((f, idx) =>
          idx === i ? { ...f, status: 'uploading' as const, progress: 0 } : f
        )
      );

      try {
        await uploadMutation.mutateAsync(fileWithProgress.file);

        // 上传成功
        setFiles((prev) =>
          prev.map((f, idx) =>
            idx === i ? { ...f, status: 'success' as const, progress: 100 } : f
          )
        );
      } catch (error: any) {
        // 上传失败
        setFiles((prev) =>
          prev.map((f, idx) =>
            idx === i
              ? {
                  ...f,
                  status: 'error' as const,
                  error: error?.message || '上传失败',
                }
              : f
          )
        );
      }
    }

    // 所有文件处理完毕
    const hasSuccess = files.some((f) => f.status === 'success');
    if (hasSuccess && onUploadComplete) {
      onUploadComplete();
    }
  };

  const pendingCount = files.filter((f) => f.status === 'pending').length;
  const successCount = files.filter((f) => f.status === 'success').length;

  return (
    <div className="space-y-4">
      {/* 拖拽区域 */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={cn(
          'border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer',
          isDragging
            ? 'border-primary bg-primary/5'
            : 'border-glassline hover:border-primary/50'
        )}
        onClick={() => document.getElementById('file-input')?.click()}
      >
        <Upload className="mx-auto h-12 w-12 text-gtext-muted mb-4" />
        <p className="text-gtext-primary font-medium mb-2">
          点击或拖拽文件到这里上传
        </p>
        <p className="text-sm text-gtext-muted">
          支持 PDF、Word、TXT、Markdown 格式，单个文件最大 10MB
        </p>
        <input
          id="file-input"
          type="file"
          multiple
          accept={acceptedExtensions}
          onChange={(e) => handleFiles(e.target.files)}
          className="hidden"
        />
      </div>

      {/* 文件列表 */}
      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((fileWithProgress, index) => (
            <div
              key={index}
              className="flex items-center gap-3 p-3 border border-glassline rounded-lg"
            >
              <FileText className="h-8 w-8 text-primary flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gtext-primary truncate">
                  {fileWithProgress.file.name}
                </p>
                <p className="text-xs text-gtext-muted">
                  {(fileWithProgress.file.size / 1024).toFixed(1)} KB
                </p>
                {fileWithProgress.status === 'error' && (
                  <p className="text-xs text-danger mt-1 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    {fileWithProgress.error}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {fileWithProgress.status === 'success' && (
                  <CheckCircle className="h-5 w-5 text-success" />
                )}
                {fileWithProgress.status === 'uploading' && (
                  <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                )}
                {(fileWithProgress.status === 'pending' ||
                  fileWithProgress.status === 'error') && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeFile(index)}
                    className="h-8 w-8 p-0"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 上传按钮 */}
      {pendingCount > 0 && (
        <div className="flex items-center justify-between pt-4 border-t border-glassline">
          <p className="text-sm text-gtext-muted">
            {pendingCount} 个文件待上传
            {successCount > 0 && `，${successCount} 个已完成`}
          </p>
          <Button onClick={uploadFiles} disabled={uploadMutation.isPending}>
            {uploadMutation.isPending ? '上传中...' : '开始上传'}
          </Button>
        </div>
      )}
    </div>
  );
}
