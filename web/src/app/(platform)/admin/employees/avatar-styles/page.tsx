'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/feedback';
import { Avatar } from '@/components/ui/avatar';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/features/admin/admin-api';
import { toast } from 'sonner';
import { ArrowLeft, Sparkles, Users } from 'lucide-react';
import Link from 'next/link';

export default function AvatarStylesPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [selectedStyle, setSelectedStyle] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState(false);

  const { data: stylesData, isLoading, isError, error } = useQuery({
    queryKey: ['avatar-styles'],
    queryFn: async () => {
      console.log('[Avatar Styles] Fetching data...');
      try {
        const result = await adminApi.getAvatarStyles();
        console.log('[Avatar Styles] Success:', result);
        return result;
      } catch (err) {
        console.error('[Avatar Styles] Error:', err);
        throw err;
      }
    },
  });

  const batchUpdateMutation = useMutation({
    mutationFn: (styleId: string) => adminApi.batchUpdateAvatarStyle(styleId),
    onSuccess: (data) => {
      toast.success(`成功更新 ${data.updated} 位员工的头像为 ${data.style} 风格`);
      queryClient.invalidateQueries({ queryKey: ['admin-employees'] });
      setConfirmDialog(false);
      setSelectedStyle(null);
    },
    onError: (error: any) => {
      toast.error(error.message || '批量更新失败');
    },
  });

  const handleStyleClick = (styleId: string) => {
    setSelectedStyle(styleId);
    setConfirmDialog(true);
  };

  const handleConfirm = () => {
    if (selectedStyle) {
      batchUpdateMutation.mutate(selectedStyle);
    }
  };

  const styles = stylesData?.styles || [];
  const recommended = stylesData?.recommended || [];
  const selectedStyleData = styles.find(s => s.id === selectedStyle);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10" />
          <Skeleton className="h-8 w-64" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => (
            <Skeleton key={i} className="h-64" />
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.back()}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-semibold">头像风格管理</h1>
        </div>
        <Card>
          <CardContent className="p-6">
            <div className="text-center space-y-4">
              <div className="text-destructive text-lg font-medium">
                加载失败
              </div>
              <div className="text-muted-foreground">
                {error instanceof Error ? error.message : '无法加载头像风格列表'}
              </div>
              <Button onClick={() => window.location.reload()}>
                重新加载
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push('/admin/employees')}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">头像风格管理</h1>
            <p className="text-sm text-fg-subtle mt-1">
              选择一种风格，一键更新所有数字员工的头像
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm text-fg-subtle">
          <Users className="h-4 w-4" />
          <span>共 {stylesData?.total || 0} 种风格</span>
        </div>
      </div>

      {/* Recommended Styles */}
      {recommended.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="h-5 w-5 text-warning" />
            <h2 className="text-lg font-medium">推荐风格</h2>
            <Badge className="bg-warning/10 text-warning">精选</Badge>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {recommended.map((style) => (
              <StyleCard
                key={style.id}
                style={style}
                onClick={() => handleStyleClick(style.id)}
                isRecommended
              />
            ))}
          </div>
        </section>
      )}

      {/* All Styles */}
      <section>
        <h2 className="text-lg font-medium mb-4">全部风格</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {styles.map((style) => (
            <StyleCard
              key={style.id}
              style={style}
              onClick={() => handleStyleClick(style.id)}
              isRecommended={style.recommended}
            />
          ))}
        </div>
      </section>

      {/* Confirmation Dialog */}
      <AlertDialog open={confirmDialog} onOpenChange={setConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认批量更新头像风格？</AlertDialogTitle>
          </AlertDialogHeader>
          {selectedStyleData && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                将所有数字员工的头像统一更新为
                <span className="font-semibold text-fg mx-1">{selectedStyleData.name}</span>
                风格。此操作会立即生效，但不影响已有的对话记录。
              </p>
              <div className="flex items-center gap-3 p-4 bg-surface-subtle rounded-lg">
                {selectedStyleData.examples.map((url, i) => (
                  <Avatar
                    key={i}
                    src={url}
                    name={`${selectedStyleData.name} ${i + 1}`}
                    className="h-14 w-14"
                  />
                ))}
              </div>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={batchUpdateMutation.isPending}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirm}
              disabled={batchUpdateMutation.isPending}
            >
              {batchUpdateMutation.isPending ? '更新中...' : '确认更新'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

interface StyleCardProps {
  style: {
    id: string;
    name: string;
    recommended: boolean;
    examples: string[];
  };
  onClick: () => void;
  isRecommended?: boolean;
}

function StyleCard({ style, onClick, isRecommended }: StyleCardProps) {
  return (
    <Card
      className="group cursor-pointer transition-all hover:shadow-md hover:scale-[1.02] border border-border-subtle hover:border-border"
      onClick={onClick}
    >
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-medium">{style.name}</CardTitle>
          {isRecommended && (
            <Badge className="bg-warning/10 text-warning text-xs">推荐</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-3 justify-center py-4">
          {style.examples.slice(0, 3).map((url, i) => (
            <Avatar
              key={i}
              src={url}
              name={`${style.name} ${i + 1}`}
              className="h-16 w-16 ring-2 ring-surface transition-all group-hover:ring-primary/20"
            />
          ))}
        </div>
        <div className="text-center mt-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full opacity-0 group-hover:opacity-100 transition-opacity"
          >
            应用此风格
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
