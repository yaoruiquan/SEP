'use client';

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Upload, FileText, Plus, Search, Edit, Trash2, FlaskConical, HardDrive, BarChart2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState, CenteredSpinner } from '@/components/ui/feedback';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useKnowledgeBase } from '@/features/knowledge/use-knowledge-bases';
import { useDocuments, useDeleteDocument, downloadDocument } from '@/features/knowledge/use-documents';
import { DocumentUploader } from '@/features/knowledge/document-uploader';
import { useTextChunks, useDeleteTextChunk } from '@/features/knowledge/use-text-chunks';
import { TextChunkEditor } from '@/features/knowledge/text-chunk-editor';
import { KnowledgeTestDialog } from '@/features/knowledge/knowledge-test-dialog';
import { DocumentStatusPanel } from '@/features/knowledge/document-status-panel';
import { KnowledgeGrantsPanel } from '@/features/knowledge/knowledge-grants-panel';

interface KnowledgeDetailPageProps {
  params: Promise<{ id: string }>;
}

export default function KnowledgeDetailPage({ params }: KnowledgeDetailPageProps) {
  const { id } = use(params);
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('documents');
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [chunkEditorOpen, setChunkEditorOpen] = useState(false);
  const [editingChunk, setEditingChunk] = useState<any>(null);
  const [testDialogOpen, setTestDialogOpen] = useState(false);

  const { data: kb, isLoading, error } = useKnowledgeBase(id);
  const { data: documents = [], isLoading: documentsLoading } = useDocuments(id);
  const { data: textChunks = [], isLoading: chunksLoading } = useTextChunks(id, search);
  const deleteMutation = useDeleteDocument(id);
  const deleteChunkMutation = useDeleteTextChunk(id);

  const handleDeleteDocument = async (documentId: string) => {
    if (confirm('确定要删除这个文档吗？')) {
      await deleteMutation.mutateAsync(documentId);
    }
  };

  const handleDeleteChunk = async (chunkId: string) => {
    if (confirm('确定要删除这个文本片段吗？')) {
      await deleteChunkMutation.mutateAsync(chunkId);
    }
  };

  const handleEditChunk = (chunk: any) => {
    setEditingChunk(chunk);
    setChunkEditorOpen(true);
  };

  const handleCloseChunkEditor = () => {
    setChunkEditorOpen(false);
    setEditingChunk(null);
  };

  const filteredDocuments = documents.filter((doc) =>
    doc.originalName.toLowerCase().includes(search.toLowerCase())
  );

  if (isLoading) {
    return <CenteredSpinner label="加载知识库详情..." />;
  }

  if (!kb) {
    return (
      <div className="container mx-auto max-w-6xl p-6">
        <EmptyState
          icon={<FileText className="h-12 w-12" />}
          title="知识库不存在"
          description="该知识库可能已被删除"
          action={
            <Button onClick={() => router.push('/knowledge')}>返回知识库列表</Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-6xl p-6">
      {/* 页头 */}
      <div className="mb-6">
        <Button
          variant="ghost"
          onClick={() => router.push('/knowledge')}
          className="mb-4 -ml-2"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          返回
        </Button>

        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gtext-primary">{kb.name}</h1>
            {kb.description && (
              <p className="mt-2 text-sm text-gtext-secondary">{kb.description}</p>
            )}
            <div className="mt-3 flex items-center gap-4 text-xs text-gtext-muted">
              <span>创建人: {kb.creator.name || kb.creator.email}</span>
              <span>创建于 {new Date(kb.createdAt).toLocaleDateString('zh-CN')}</span>
              <span>更新于 {new Date(kb.updatedAt).toLocaleDateString('zh-CN')}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => router.push(`/knowledge/${id}/analytics`)}
            >
              <BarChart2 className="mr-2 h-4 w-4" />
              检索分析
            </Button>
            <Button
              variant="outline"
              onClick={() => setTestDialogOpen(true)}
            >
              <FlaskConical className="mr-2 h-4 w-4" />
              测试检索
            </Button>
            <Button>
              <Edit className="mr-2 h-4 w-4" />
              编辑
            </Button>
          </div>
        </div>
      </div>

      {/* 统计卡片 */}
      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <FileText className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gtext-primary">
                {kb._count.documents}
              </p>
              <p className="text-sm text-gtext-muted">文档</p>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <FileText className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gtext-primary">
                {kb._count.textChunks}
              </p>
              <p className="text-sm text-gtext-muted">文本片段</p>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <FileText className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gtext-primary">
                {kb._count.grants}
              </p>
              <p className="text-sm text-gtext-muted">授权员工</p>
            </div>
          </div>
        </Card>
      </div>

      {/* 标签页 */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="documents">文档</TabsTrigger>
          <TabsTrigger value="chunks">文本片段</TabsTrigger>
          <TabsTrigger value="status">
            <HardDrive className="mr-1.5 h-3.5 w-3.5" />
            文档状态
          </TabsTrigger>
          <TabsTrigger value="grants">授权管理</TabsTrigger>
        </TabsList>

        {/* 文档标签页 */}
        <TabsContent value="documents" className="mt-6">
          <div className="mb-4 flex items-center justify-between">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gtext-muted" />
              <Input
                placeholder="搜索文档..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
            <Button onClick={() => setUploadDialogOpen(true)}>
              <Upload className="mr-2 h-4 w-4" />
              上传文档
            </Button>
          </div>

          {uploadDialogOpen && (
            <div className="mb-6 p-4 border border-glassline rounded-lg bg-glassbg">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-gtext-primary">上传文档</h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setUploadDialogOpen(false)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <DocumentUploader
                knowledgeBaseId={id}
                onUploadComplete={() => setUploadDialogOpen(false)}
              />
            </div>
          )}

          {documentsLoading ? (
            <CenteredSpinner label="加载文档..." />
          ) : filteredDocuments.length === 0 ? (
            <EmptyState
              icon={<FileText className="h-12 w-12" />}
              title={search ? '未找到匹配的文档' : '还没有文档'}
              description={
                search ? '试试其他关键词' : '上传第一个文档，支持 PDF、Word、TXT 等格式'
              }
              action={
                !search && (
                  <Button onClick={() => setUploadDialogOpen(true)}>
                    <Upload className="mr-2 h-4 w-4" />
                    上传文档
                  </Button>
                )
              }
            />
          ) : (
            <div className="space-y-2">
              {filteredDocuments.map((doc) => (
                <Card key={doc.id} className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <FileText className="h-8 w-8 text-primary flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gtext-primary truncate">
                          {doc.originalName}
                        </p>
                        <div className="flex items-center gap-3 text-xs text-gtext-muted mt-1">
                          <span>{(doc.fileSize / 1024).toFixed(1)} KB</span>
                          <span>上传者: {doc.uploader.name || doc.uploader.email}</span>
                          <span>
                            {new Date(doc.createdAt).toLocaleDateString('zh-CN')}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={
                          doc.status === 'COMPLETED'
                            ? 'default'
                            : doc.status === 'FAILED'
                            ? 'glass-danger'
                            : 'glass-info'
                        }
                      >
                        {doc.status === 'PENDING'
                          ? '待处理'
                          : doc.status === 'PROCESSING'
                          ? '处理中'
                          : doc.status === 'COMPLETED'
                          ? '已完成'
                          : '失败'}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => downloadDocument(id, doc.id)}
                        className="h-8 w-8 p-0"
                      >
                        <Upload className="h-4 w-4 rotate-180" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteDocument(doc.id)}
                        className="h-8 w-8 p-0 text-danger hover:text-danger"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* 文本片段标签页 */}
        <TabsContent value="chunks" className="mt-6">
          <div className="mb-4 flex items-center justify-between">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gtext-muted" />
              <Input
                placeholder="搜索文本片段..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
            <Button onClick={() => setChunkEditorOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              添加文本片段
            </Button>
          </div>

          {chunksLoading ? (
            <CenteredSpinner label="加载文本片段..." />
          ) : textChunks.length === 0 ? (
            <EmptyState
              icon={<FileText className="h-12 w-12" />}
              title={search ? '未找到匹配的文本片段' : '还没有文本片段'}
              description={
                search
                  ? '试试其他关键词'
                  : '添加第一个文本片段，或上传文档自动生成'
              }
              action={
                !search && (
                  <Button onClick={() => setChunkEditorOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    添加文本片段
                  </Button>
                )
              }
            />
          ) : (
            <div className="space-y-3">
              {textChunks.map((chunk) => (
                <Card key={chunk.id} className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      {chunk.title && (
                        <h4 className="font-medium text-gtext-primary mb-2">
                          {chunk.title}
                        </h4>
                      )}
                      <p className="text-sm text-gtext-secondary line-clamp-3 mb-3">
                        {chunk.content}
                      </p>
                      <div className="flex items-center gap-3 flex-wrap">
                        {chunk.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {chunk.tags.map((tag) => (
                              <Badge key={tag} variant="glass-info" className="text-xs">
                                {tag}
                              </Badge>
                            ))}
                          </div>
                        )}
                        <div className="flex items-center gap-3 text-xs text-gtext-muted ml-auto">
                          <span>
                            来源: {chunk.source === 'manual' ? '手动添加' : '文档'}
                          </span>
                          {chunk.creator && (
                            <span>
                              创建者: {chunk.creator.name || chunk.creator.email}
                            </span>
                          )}
                          <span>
                            {new Date(chunk.createdAt).toLocaleDateString('zh-CN')}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleEditChunk(chunk)}
                        className="h-8 w-8 p-0"
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteChunk(chunk.id)}
                        className="h-8 w-8 p-0 text-danger hover:text-danger"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* 文档状态标签页 */}
        <TabsContent value="status" className="mt-6">
          <DocumentStatusPanel knowledgeBaseId={id} />
        </TabsContent>

        {/* 授权管理标签页 */}
        <TabsContent value="grants" className="mt-6">
          <KnowledgeGrantsPanel knowledgeBaseId={id} />
        </TabsContent>
      </Tabs>

      {/* 文本片段编辑器 */}
      <TextChunkEditor
        open={chunkEditorOpen}
        knowledgeBaseId={id}
        textChunk={editingChunk}
        onClose={handleCloseChunkEditor}
      />

      {/* 检索测试对话框 */}
      <KnowledgeTestDialog
        open={testDialogOpen}
        knowledgeBaseId={id}
        onClose={() => setTestDialogOpen(false)}
      />
    </div>
  );
}
