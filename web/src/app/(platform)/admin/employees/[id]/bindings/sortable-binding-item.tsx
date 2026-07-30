'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { GripVertical, Settings } from 'lucide-react';

export function SortableBindingItem({
  binding,
  onToggleEnabled,
  onEditConfig,
}: {
  binding: any;
  onToggleEnabled: (bindingId: string, enabled: boolean) => void;
  onEditConfig: (bindingId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: binding.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    boxShadow: isDragging ? '0 10px 30px rgba(0,0,0,0.2)' : undefined,
    cursor: isDragging ? 'grabbing' : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 p-4 border rounded-lg bg-background"
    >
      {/* 拖拽手柄 */}
      <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing">
        <GripVertical className="h-5 w-5 text-muted-foreground" />
      </div>

      {/* 能力信息 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <p className="font-medium">{binding.capability.name}</p>
          <Badge className="border border-border bg-secondary/50">{binding.capability.type}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">{binding.capability.description}</p>
        <p className="text-xs text-muted-foreground/70 mt-1">优先级: {binding.priority}</p>
      </div>

      {/* 操作区 */}
      <div className="flex items-center gap-3">
        {/* 启用/禁用开关 */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">启用</span>
          <Switch
            checked={binding.enabled}
            onCheckedChange={(checked) => onToggleEnabled(binding.id, checked)}
          />
        </div>

        {/* 配置按钮 */}
        <Button variant="ghost" size="sm" onClick={() => onEditConfig(binding.id)}>
          <Settings className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
