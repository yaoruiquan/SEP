'use client';

import { useState } from 'react';
import { Plus, Search, FileText, Users, Calendar, Edit, Trash2, BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState, CenteredSpinner } from '@/components/ui/feedback';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useKnowledgeBases, useDeleteKnowledgeBase } from '@/features/knowledge/use-knowledge-bases';
import { KnowledgeDialog } from '@/features/knowledge/knowledge-dialog';
import { useRouter } from 'next/navigation';
import type { KnowledgeBase } from '@/lib/types';

export default function KnowledgePage() {
  const router = useRouter();
  const { data: knowledgeBases = [], isLoading } = useKnowledgeBases();
  const deleteMutation = useDeleteKnowledgeBase();

  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingKb, setEditingKb] = useState<KnowledgeBase | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const filteredKbs = knowledgeBases.filter((kb) =>
    kb.name.toLowerCase().includes(search.toLowerCase())
  );

  const handleEdit = (kb: KnowledgeBase) => {
    setEditingKb(kb);
    setDialogOpen(true);
  };

  const handleDeleteClick = (kb: KnowledgeBase) => {
    setDeletingId(kb.id);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!deletingId) return;
    await deleteMutation.mutateAsync(deletingId);
    setDeletingId(null);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setEditingKb(null);
  };

  const handleCardClick = (id: string) => {
    router.push(`/knowledge/${id}`);
  };

  if (isLoading) {
    return <CenteredSpinner label="加载知识库..." />;
  }

  return (
    <div className="container mx-auto max-w-6xl p-6">
      {/* 页头 */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gtext-primary">
            <BookOpen className="h-6 w-6 text-primary" />
            知识库
          </h1>
          <p className="mt-1 text-sm text-gtext-muted">
            管理企业知识，为数字员工提供专业知识支持
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          新建知识库
        </Button>
      </div>

      {/* 搜索框 */}
      <div className="mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gtext-muted" />
          <Input
            placeholder="搜索知识库..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {/* 知识库列表 */}
      {filteredKbs.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-12 w-12" />}
          title={search ? '未找到匹配的知识库' : '还没有知识库'}
          description={
            search
              ? '试试其他关键词'
              : '创建第一个知识库，上传文档或添加知识内容，让数字员工更专业'
          }
          action={
            !search && (
              <Button onClick={() => setDialogOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                新建知识库
              </Button>
            )
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredKbs.map((kb) => (
            <Card
              key={kb.id}
              className="cursor-pointer p-5 transition-all hover:border-primary hover:shadow-md"
              onClick={() => handleCardClick(kb.id)}
            >
              <div className="mb-3 flex items-start justify-between">
                <h3 className="flex-1 text-lg font-semibold text-gtext-primary">
                  {kb.name}
                </h3>
                <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleEdit(kb)}
                    className="h-8 w-8 p-0"
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDeleteClick(kb)}
                    className="h-8 w-8 p-0 text-danger hover:text-danger"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {kb.description && (
                <p className="mb-4 line-clamp-2 text-sm text-gtext-secondary">
                  {kb.description}
                </p>
              )}

              <div className="flex items-center gap-4 text-xs text-gtext-muted">
                <div className="flex items-center gap-1">
                  <FileText className="h-3.5 w-3.5" />
                  <span>{kb._count?.documents ?? 0} 个文档</span>
                </div>
                <div className="flex items-center gap-1">
                  <Users className="h-3.5 w-3.5" />
                  <span>授权 {kb._count?.grants ?? 0} 个员工</span>
                </div>
              </div>

              <div className="mt-3 pt-3 border-t border-glassline flex items-center justify-between text-xs text-gtext-muted">
                <span>创建人: {kb.creator.name || kb.creator.email}</span>
                <span>
                  更新于 {new Date(kb.updatedAt).toLocaleDateString('zh-CN')}
                </span>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* 新建/编辑对话框 */}
      <KnowledgeDialog
        open={dialogOpen}
        knowledgeBase={editingKb}
        onClose={handleCloseDialog}
      />

      {/* 删除确认对话框 */}
      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="确认删除知识库"
        description="删除后所有文档、文本片段和授权记录将被永久删除，且无法恢复。"
        variant="danger"
        confirmText="删除"
        onConfirm={handleDeleteConfirm}
      />
    </div>
  );
}
