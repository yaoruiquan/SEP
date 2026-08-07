'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
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
import { useCreateKnowledgeBase, useUpdateKnowledgeBase } from './use-knowledge-bases';
import type { KnowledgeBase } from '@/lib/types';

const knowledgeBaseSchema = z.object({
  name: z.string().min(1, '知识库名称不能为空').max(100, '名称最多 100 个字符'),
  description: z.string().max(500, '描述最多 500 个字符').optional(),
});

type KnowledgeBaseFormData = z.infer<typeof knowledgeBaseSchema>;

interface KnowledgeDialogProps {
  open: boolean;
  knowledgeBase?: KnowledgeBase | null;
  onClose: () => void;
}

export function KnowledgeDialog({ open, knowledgeBase, onClose }: KnowledgeDialogProps) {
  const createMutation = useCreateKnowledgeBase();
  const updateMutation = useUpdateKnowledgeBase();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<KnowledgeBaseFormData>({
    resolver: zodResolver(knowledgeBaseSchema),
  });

  // 当对话框打开或编辑的知识库变化时，重置表单
  useEffect(() => {
    if (open) {
      if (knowledgeBase) {
        reset({
          name: knowledgeBase.name,
          description: knowledgeBase.description || '',
        });
      } else {
        reset({ name: '', description: '' });
      }
    }
  }, [open, knowledgeBase, reset]);

  const onSubmit = async (data: KnowledgeBaseFormData) => {
    try {
      if (knowledgeBase) {
        // 更新
        await updateMutation.mutateAsync({
          id: knowledgeBase.id,
          data,
        });
      } else {
        // 创建
        await createMutation.mutateAsync(data);
      }
      onClose();
    } catch (error) {
      // 错误已经在 mutation 中处理了
      console.error('Failed to save knowledge base:', error);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{knowledgeBase ? '编辑知识库' : '新建知识库'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-4">
          {/* 名称 */}
          <div className="space-y-2">
            <Label htmlFor="name">
              知识库名称 <span className="text-danger">*</span>
            </Label>
            <Input
              id="name"
              placeholder="例如：产品知识库、技术文档、市场资料"
              {...register('name')}
            />
            {errors.name && (
              <p className="text-sm text-danger">{errors.name.message}</p>
            )}
          </div>

          {/* 描述 */}
          <div className="space-y-2">
            <Label htmlFor="description">描述（可选）</Label>
            <Textarea
              id="description"
              placeholder="简单描述这个知识库的用途和内容..."
              rows={4}
              {...register('description')}
            />
            {errors.description && (
              <p className="text-sm text-danger">{errors.description.message}</p>
            )}
          </div>

          {/* 操作按钮 */}
          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? '保存中...' : knowledgeBase ? '保存' : '创建'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
