'use client';

import { Bot, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Textarea } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogHeader } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { StatusDot } from '@/components/ui/status-dot';
import { MetricCard } from '@/components/dashboard/metric-card';
import { useState } from 'react';

export function Phase1Demos() {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="space-y-12">
      {/* Button variants */}
      <div>
        <h3 className="mb-4 text-sm font-medium text-gtext-secondary">Button</h3>
        <div className="flex flex-wrap gap-3">
          <Button variant="glass">Glass Button</Button>
          <Button variant="glass-primary">Glass Primary</Button>
          <Button variant="glass" size="sm">Small Glass</Button>
          <Button variant="glass-primary" size="lg">Large Primary</Button>
        </div>
      </div>

      {/* Card variants */}
      <div>
        <h3 className="mb-4 text-sm font-medium text-gtext-secondary">Card</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Card variant="solid" className="p-5">
            <h4 className="text-sm font-semibold text-foreground">Solid Card (默认)</h4>
            <p className="mt-2 text-sm text-fg-muted">用于现有浅色页面，保持向后兼容。</p>
          </Card>
          <Card variant="glass" className="p-5">
            <h4 className="text-sm font-semibold text-gtext-primary">Glass Card</h4>
            <p className="mt-2 text-sm text-gtext-secondary">半透明 + blur + 亮边，深色画布专用。</p>
          </Card>
        </div>
      </div>

      {/* Input & Textarea */}
      <div>
        <h3 className="mb-4 text-sm font-medium text-gtext-secondary">Input / Textarea</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input placeholder="Glass input..." glass />
          <Input placeholder="Regular input" />
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Textarea placeholder="Glass textarea..." glass rows={3} />
          <Textarea placeholder="Regular textarea" rows={3} />
        </div>
      </div>

      {/* Badge variants */}
      <div>
        <h3 className="mb-4 text-sm font-medium text-gtext-secondary">Badge</h3>
        <div className="flex flex-wrap gap-2">
          <Badge variant="glass">Glass Badge</Badge>
          <Badge variant="glass-success">Success</Badge>
          <Badge variant="glass-warning">Warning</Badge>
          <Badge variant="glass-danger">Danger</Badge>
          <Badge variant="glass-info">Info</Badge>
        </div>
      </div>

      {/* Dialog */}
      <div>
        <h3 className="mb-4 text-sm font-medium text-gtext-secondary">Dialog</h3>
        <div className="flex gap-3">
          <Button variant="glass" onClick={() => setDialogOpen(true)}>
            Open Glass Dialog
          </Button>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent glass>
            <DialogHeader>
              <DialogTitle>Glass Dialog</DialogTitle>
              <DialogDescription>
                玻璃 Modal，遮罩 blur 更强（28px），内容区用 .glass-elevated。
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <Input placeholder="Email address" glass />
              <Button variant="glass-primary" className="w-full">Submit</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Select */}
      <div>
        <h3 className="mb-4 text-sm font-medium text-gtext-secondary">Select</h3>
        <Select>
          <SelectTrigger glass className="w-60">
            <SelectValue placeholder="Choose option..." />
          </SelectTrigger>
          <SelectContent glass>
            <SelectItem value="opt1">Option 1</SelectItem>
            <SelectItem value="opt2">Option 2</SelectItem>
            <SelectItem value="opt3">Option 3</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Dropdown Menu */}
      <div>
        <h3 className="mb-4 text-sm font-medium text-gtext-secondary">Dropdown Menu</h3>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="glass">Open Menu</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent glass>
            <DropdownMenuItem>Profile</DropdownMenuItem>
            <DropdownMenuItem>Settings</DropdownMenuItem>
            <DropdownMenuItem>Logout</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* StatusDot */}
      <div>
        <h3 className="mb-4 text-sm font-medium text-gtext-secondary">StatusDot (with glow)</h3>
        <div className="flex flex-wrap gap-4">
          <StatusDot status="online" showLabel glow />
          <StatusDot status="busy" showLabel glow />
          <StatusDot status="connecting" showLabel glow />
          <StatusDot status="offline" showLabel glow />
        </div>
      </div>

      {/* MetricCard */}
      <div>
        <h3 className="mb-4 text-sm font-medium text-gtext-secondary">MetricCard</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <MetricCard
            title="AI 员工"
            value={42}
            icon={Bot}
            trend={{ direction: 'up', value: 12, label: '较上月' }}
            variant="glass"
          />
          <MetricCard
            title="任务完成"
            value="1,234"
            icon={TrendingUp}
            trend={{ direction: 'up', value: 8 }}
            variant="glass"
          />
        </div>
      </div>
    </div>
  );
}
