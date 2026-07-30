'use client';

import { use, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useEmployeeBindings, useUpdateBinding } from '@/features/admin/use-admin';
import { SortableBindingItem } from './sortable-binding-item';

export default function BindingsManagePage({ params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = use(paramsPromise);
  const router = useRouter();
  const { data: bindings, isLoading } = useEmployeeBindings(params.id);
  const updateBindingMutation = useUpdateBinding();

  const [items, setItems] = useState<any[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [editingConfig, setEditingConfig] = useState<{ bindingId: string; config: string } | null>(null);

  // 初始化排序项
  useEffect(() => {
    if (bindings) {
      setItems([...bindings].sort((a, b) => b.priority - a.priority));
    }
  }, [bindings]);

  // 拖拽传感器
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // 处理拖拽结束
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = items.findIndex((item) => item.id === active.id);
    const newIndex = items.findIndex((item) => item.id === over.id);

    const newItems = arrayMove(items, oldIndex, newIndex);
    setItems(newItems);

    // 更新优先级（最上面的优先级最高）
    setIsSaving(true);
    try {
      await Promise.all(
        newItems.map((item, index) =>
          updateBindingMutation.mutateAsync({
            bindingId: item.id,
            data: { priority: newItems.length - index },
          })
        )
      );
      toast.success('优先级已更新');
    } catch (error) {
      toast.error('更新失败');
      if (bindings) {
        setItems([...bindings].sort((a, b) => b.priority - a.priority));
      }
    } finally {
      setIsSaving(false);
    }
  };

  // 处理启用/禁用
  const handleToggleEnabled = async (bindingId: string, enabled: boolean) => {
    try {
      await updateBindingMutation.mutateAsync({
        bindingId,
        data: { enabled },
      });
      toast.success(enabled ? '已启用' : '已禁用');
    } catch (error) {
      toast.error('操作失败');
    }
  };

  // 处理配置编辑
  const handleSaveConfig = async () => {
    if (!editingConfig) return;

    try {
      const config = JSON.parse(editingConfig.config);
      await updateBindingMutation.mutateAsync({
        bindingId: editingConfig.bindingId,
        data: { config },
      });
      toast.success('配置已保存');
      setEditingConfig(null);
    } catch (error: any) {
      if (error instanceof SyntaxError) {
        toast.error('JSON 格式错误');
      } else {
        toast.error('保存失败');
      }
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
        <p className="text-muted-foreground">加载中...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 顶部导航 */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          返回
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">能力绑定管理</h1>
          <p className="text-sm text-muted-foreground mt-1">
            💡 拖拽卡片调整优先级，使用开关启用/禁用能力
          </p>
        </div>
        {isSaving && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在保存...
          </div>
        )}
      </div>

      {/* 绑定列表 */}
      <Card>
        <CardHeader>
          <CardTitle>已绑定能力 ({items.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-6xl mb-4">🔧</div>
              <h3 className="text-lg font-semibold mb-2">暂无绑定的能力</h3>
              <p className="text-sm text-muted-foreground mb-4">
                员工需要至少绑定一个能力才能工作
              </p>
              <Link href={`/admin/employees/${params.id}/edit`}>
                <Button>前往绑定能力</Button>
              </Link>
            </div>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-2">
                  {items.map((binding) => (
                    <SortableBindingItem
                      key={binding.id}
                      binding={binding}
                      onToggleEnabled={handleToggleEnabled}
                      onEditConfig={(bindingId) =>
                        setEditingConfig({
                          bindingId,
                          config: JSON.stringify(binding.config || {}, null, 2),
                        })
                      }
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </CardContent>
      </Card>

      {/* 配置编辑对话框 */}
      <Dialog open={!!editingConfig} onOpenChange={() => setEditingConfig(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑能力配置</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm text-muted-foreground">JSON 配置</label>
              <Textarea
                className="mt-2 font-mono text-sm"
                rows={10}
                value={editingConfig?.config || ''}
                onChange={(e) => setEditingConfig({ ...editingConfig!, config: e.target.value })}
                placeholder='{\n  "key": "value"\n}'
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditingConfig(null)}>
                取消
              </Button>
              <Button onClick={handleSaveConfig}>保存</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
