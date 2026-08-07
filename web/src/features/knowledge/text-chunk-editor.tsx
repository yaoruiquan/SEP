'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useCreateTextChunk, useUpdateTextChunk } from './use-text-chunks';

const textChunkSchema = z.object({
  title: z.string().max(200, '标题最多 200 个字符').optional(),
  content: z.string().min(1, '内容不能为空').max(10000, '内容最多 10000 个字符'),
});

type TextChunkFormData = z.infer<typeof textChunkSchema>;

interface TextChunk {
  id: string;
  title: string | null;
  content: string;
  tags: string[];
}

interface TextChunkEditorProps {
  open: boolean;
  knowledgeBaseId: string;
  textChunk?: TextChunk | null;
  onClose: () => void;
}

export function TextChunkEditor({
  open,
  knowledgeBaseId,
  textChunk,
  onClose,
}: TextChunkEditorProps) {
  const createMutation = useCreateTextChunk(knowledgeBaseId);
  const updateMutation = useUpdateTextChunk(knowledgeBaseId);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<TextChunkFormData>({
    resolver: zodResolver(textChunkSchema),
  });

  // 当对话框打开或编辑的片段变化时，重置表单
  useEffect(() => {
    if (open) {
      if (textChunk) {
        reset({
          title: textChunk.title || '',
          content: textChunk.content,
        });
        setTags(textChunk.tags || []);
      } else {
        reset({ title: '', content: '' });
        setTags([]);
      }
    }
  }, [open, textChunk, reset]);

  const onSubmit = async (data: TextChunkFormData) => {
    try {
      if (textChunk) {
        // 更新
        await updateMutation.mutateAsync({
          id: textChunk.id,
          data: {
            title: data.title || undefined,
            content: data.content,
            tags,
          },
        });
      } else {
        // 创建
        await createMutation.mutateAsync({
          title: data.title || undefined,
          content: data.content,
          tags,
        });
      }
      onClose();
    } catch (error) {
      console.error('Failed to save text chunk:', error);
    }
  };

  const handleAddTag = () => {
    const trimmed = tagInput.trim();
    if (trimmed && !tags.includes(trimmed) && tags.length < 10) {
      setTags([...tags, trimmed]);
      setTagInput('');
    }
  };

  const handleRemoveTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag));
  };

  const handleTagInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddTag();
    }
  };

  return (
    <Dialog open={open} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>{textChunk ? '编辑文本片段' : '添加文本片段'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-4">
          {/* 标题 */}
          <div className="space-y-2">
            <Label htmlFor="title">标题（可选）</Label>
            <Input
              id="title"
              placeholder="为这段内容起一个标题..."
              {...register('title')}
            />
            {errors.title && (
              <p className="text-sm text-danger">{errors.title.message}</p>
            )}
          </div>

          {/* 内容 */}
          <div className="space-y-2">
            <Label htmlFor="content">
              内容 <span className="text-danger">*</span>
            </Label>
            <Textarea
              id="content"
              placeholder="输入或粘贴文本内容..."
              rows={10}
              {...register('content')}
            />
            {errors.content && (
              <p className="text-sm text-danger">{errors.content.message}</p>
            )}
          </div>

          {/* 标签 */}
          <div className="space-y-2">
            <Label htmlFor="tags">标签（最多 10 个）</Label>
            <div className="flex gap-2">
              <Input
                id="tags"
                placeholder="输入标签后按回车..."
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleTagInputKeyDown}
                disabled={tags.length >= 10}
              />
              <Button
                type="button"
                variant="outline"
                onClick={handleAddTag}
                disabled={!tagInput.trim() || tags.length >= 10}
              >
                添加
              </Button>
            </div>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {tags.map((tag) => (
                  <Badge key={tag} variant="glass-info" className="gap-1">
                    {tag}
                    <button
                      type="button"
                      onClick={() => handleRemoveTag(tag)}
                      className="ml-1 hover:text-danger"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* 操作按钮 */}
          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? '保存中...' : textChunk ? '保存' : '创建'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
