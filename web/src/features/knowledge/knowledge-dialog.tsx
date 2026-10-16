'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { KnowledgeBaseCreateDtoSchema } from 'shared/knowledge.dto';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useCreateKnowledgeBase, useUpdateKnowledgeBase } from './use-knowledge-bases';
import { knowledgeError } from './knowledge-ui';

type KnowledgeBaseFormData = z.infer<typeof KnowledgeBaseCreateDtoSchema>;

/** 编辑弹窗只读取名称/描述，结构子集同时兼容列表页与详情页的知识库类型。 */
interface EditableKnowledgeBase {
  id: string;
  name: string;
  description: string | null;
}

interface KnowledgeDialogProps {
  open: boolean;
  knowledgeBase?: EditableKnowledgeBase | null;
  onClose: () => void;
}

export function KnowledgeDialog({ open, knowledgeBase, onClose }: KnowledgeDialogProps) {
  const [saveError, setSaveError] = useState<string | null>(null);
  const createMutation = useCreateKnowledgeBase();
  const updateMutation = useUpdateKnowledgeBase();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<KnowledgeBaseFormData>({
    resolver: zodResolver(KnowledgeBaseCreateDtoSchema),
  });

  // 当对话框打开或编辑的知识库变化时，重置表单
  useEffect(() => {
    if (open) {
      setSaveError(null);
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
    setSaveError(null);
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
      setSaveError(knowledgeError(error));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(open) => !open && !isSubmitting && onClose()}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{knowledgeBase ? '编辑知识库' : '新建知识库'}</DialogTitle>
          <DialogDescription>资料和成员权限将在网页与客户端同步。</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-4">
          {saveError && <p role="alert" className="text-sm text-danger">{saveError}</p>}
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
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
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
