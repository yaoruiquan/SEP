'use client';

import { useState } from 'react';
import {
  BookOpen,
  Upload,
  Search,
  Trash2,
  Lock,
  FileText,
  File,
  Download,
  Eye,
  MoreVertical,
  Plus,
  Folder,
  Users,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { toast } from '@/components/ui/toast';
import { ProgressBar } from '@/components/ui/progress-bar';

/**
 * 知识库管理页
 * 路由：/knowledge
 * 功能：文件管理 + 分类 + 搜索 + 授权员工
 */
export default function KnowledgePage() {
  const [selectedKnowledge, setSelectedKnowledge] = useState<string>('kb1');
  const [searchQuery, setSearchQuery] = useState('');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  return (
    <div className="min-h-screen bg-neutral-50 p-6">
      {/* 页头 */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 flex items-center gap-2">
            <BookOpen className="w-6 h-6 text-primary" />
            知识库管理
          </h1>
          <p className="text-sm text-neutral-600 mt-1">
            管理企业知识库文件，授权给硅基员工使用
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm">
            <Plus className="w-4 h-4 mr-2" />
            创建知识库
          </Button>
          <Button variant="primary" size="sm">
            <Upload className="w-4 h-4 mr-2" />
            上传文件
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* 左侧：知识库列表 */}
        <div className="lg:col-span-1">
          <KnowledgeList
            selectedId={selectedKnowledge}
            onSelect={setSelectedKnowledge}
          />
        </div>

        {/* 右侧：文件列表 */}
        <div className="lg:col-span-3">
          <FileList
            knowledgeId={selectedKnowledge}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onDeleteFile={(fileId) => {
              setSelectedFile(fileId);
              setDeleteDialogOpen(true);
            }}
          />
        </div>
      </div>

      {/* 删除确认对话框 */}
      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="确认删除文件"
        description="删除后文件将无法恢复，已授权的员工将无法继续访问此文件。"
        variant="danger"
        confirmText="删除"
        onConfirm={async () => {
          toast.success('文件已删除');
          setSelectedFile(null);
        }}
      />
    </div>
  );
}

// ============ 知识库列表 ============

interface Knowledge {
  id: string;
  name: string;
  fileCount: number;
  restricted: boolean;
  scope: 'enterprise' | 'department' | 'employee';
}

function KnowledgeList({
  selectedId,
  onSelect,
}: {
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const knowledgeList: Knowledge[] = [
    { id: 'kb1', name: '企业介绍', fileCount: 3, restricted: false, scope: 'enterprise' },
    { id: 'kb2', name: '产品手册', fileCount: 12, restricted: false, scope: 'enterprise' },
    { id: 'kb3', name: '客户资料', fileCount: 45, restricted: true, scope: 'department' },
    { id: 'kb4', name: '销售话术', fileCount: 8, restricted: false, scope: 'department' },
    { id: 'kb5', name: 'FAQ 常见问题', fileCount: 15, restricted: false, scope: 'enterprise' },
  ];

  const scopeLabels = {
    enterprise: '企业级',
    department: '部门级',
    employee: '员工级',
  };

  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold text-neutral-700 mb-3 flex items-center gap-2">
        <Folder className="w-4 h-4" />
        知识库列表
      </h3>
      <div className="space-y-2">
        {knowledgeList.map((kb) => (
          <button
            key={kb.id}
            onClick={() => onSelect(kb.id)}
            className={`w-full text-left p-3 rounded-lg transition-all ${
              selectedId === kb.id
                ? 'bg-primary/10 border-2 border-primary'
                : 'bg-white border border-neutral-200 hover:border-neutral-300'
            }`}
          >
            <div className="flex items-start justify-between gap-2 mb-1">
              <span className="font-medium text-neutral-900 text-sm">
                {kb.name}
              </span>
              {kb.restricted && <Lock className="w-4 h-4 text-neutral-400" />}
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-neutral-600">{kb.fileCount} 个文件</span>
              <Badge className="text-xs bg-neutral-100 text-neutral-600">
                {scopeLabels[kb.scope]}
              </Badge>
            </div>
          </button>
        ))}
      </div>

      <Button variant="outline" size="sm" className="w-full mt-4">
        <Plus className="w-4 h-4 mr-2" />
        新建知识库
      </Button>
    </Card>
  );
}

// ============ 文件列表 ============

interface KnowledgeFile {
  id: string;
  name: string;
  size: string;
  type: 'pdf' | 'docx' | 'txt' | 'xlsx';
  status: 'parsed' | 'parsing' | 'failed';
  uploadedAt: string;
  authorizedEmployees: number;
  progress?: number;
}

function FileList({
  knowledgeId,
  searchQuery,
  onSearchChange,
  onDeleteFile,
}: {
  knowledgeId: string;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onDeleteFile: (fileId: string) => void;
}) {
  // Mock 文件数据
  const files: KnowledgeFile[] = [
    {
      id: 'f1',
      name: '公司简介.pdf',
      size: '2.3MB',
      type: 'pdf',
      status: 'parsed',
      uploadedAt: '2024-01-15 14:30',
      authorizedEmployees: 5,
    },
    {
      id: 'f2',
      name: '产品介绍.docx',
      size: '1.8MB',
      type: 'docx',
      status: 'parsed',
      uploadedAt: '2024-01-14 10:20',
      authorizedEmployees: 3,
    },
    {
      id: 'f3',
      name: 'FAQ.txt',
      size: '45KB',
      type: 'txt',
      status: 'parsed',
      uploadedAt: '2024-01-13 16:45',
      authorizedEmployees: 8,
    },
    {
      id: 'f4',
      name: '客户数据表.xlsx',
      size: '5.2MB',
      type: 'xlsx',
      status: 'parsing',
      uploadedAt: '2024-01-15 15:00',
      authorizedEmployees: 0,
      progress: 65,
    },
  ];

  const filteredFiles = files.filter((file) =>
    file.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const statusConfig = {
    parsed: { label: '已解析', color: 'bg-success/10 text-success' },
    parsing: { label: '解析中', color: 'bg-warning/10 text-warning' },
    failed: { label: '失败', color: 'bg-danger/10 text-danger' },
  };

  const typeIcons = {
    pdf: FileText,
    docx: FileText,
    txt: File,
    xlsx: FileText,
  };

  return (
    <Card className="p-6">
      {/* 文件列表头部 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-neutral-900">企业介绍</h2>
          <p className="text-sm text-neutral-600 mt-1">
            授权员工: 5 个 · 总大小: 4.15MB
          </p>
        </div>
        <Button variant="outline" size="sm">
          <Users className="w-4 h-4 mr-2" />
          管理授权
        </Button>
      </div>

      {/* 搜索框 */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
        <Input
          placeholder="搜索文件名..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* 文件列表 */}
      <div className="space-y-3">
        {filteredFiles.map((file) => {
          const Icon = typeIcons[file.type];
          const status = statusConfig[file.status];

          return (
            <div
              key={file.id}
              className="p-4 bg-neutral-50 rounded-lg border border-neutral-200 hover:border-neutral-300 transition-colors"
            >
              <div className="flex items-start gap-4">
                {/* 文件图标 */}
                <div className="w-12 h-12 rounded-glass-md border border-ginfo/25 bg-ginfo/12 flex items-center justify-center flex-shrink-0">
                  <Icon className="w-6 h-6 text-gneon-blue" />
                </div>

                {/* 文件信息 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-neutral-900 truncate">
                        {file.name}
                      </h3>
                      <p className="text-sm text-neutral-600 mt-1">
                        {file.size} · 上传于 {file.uploadedAt}
                      </p>
                    </div>
                    <Badge className={status.color}>{status.label}</Badge>
                  </div>

                  {/* 解析进度 */}
                  {file.status === 'parsing' && file.progress !== undefined && (
                    <ProgressBar
                      value={file.progress}
                      variant="default"
                      showLabel
                      label={`解析中 ${file.progress}%`}
                      size="sm"
                    />
                  )}

                  {/* 授权信息 */}
                  {file.status === 'parsed' && (
                    <div className="flex items-center justify-between mt-3">
                      <span className="text-sm text-neutral-600">
                        已授权 {file.authorizedEmployees} 个员工使用
                      </span>
                      <div className="flex items-center gap-2">
                        <Button variant="ghost" size="sm">
                          <Eye className="w-4 h-4 mr-1" />
                          预览
                        </Button>
                        <Button variant="ghost" size="sm">
                          <Download className="w-4 h-4 mr-1" />
                          下载
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onDeleteFile(file.id)}
                        >
                          <Trash2 className="w-4 h-4 text-danger" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {filteredFiles.length === 0 && (
        <div className="text-center py-12">
          <FileText className="w-12 h-12 text-neutral-300 mx-auto mb-3" />
          <p className="text-neutral-600">
            {searchQuery ? '没有找到匹配的文件' : '暂无文件，点击上传按钮添加'}
          </p>
        </div>
      )}
    </Card>
  );
}
