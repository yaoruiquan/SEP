'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFocusReturn, useEscapeKey } from '@/lib/accessibility';
import { usePrefersReducedMotion } from '@/lib/responsive';

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay> & {
    glass?: boolean;
  }
>(({ className, glass, ...props }, ref) => {
  const prefersReducedMotion = usePrefersReducedMotion();

  return (
    <DialogPrimitive.Overlay
      ref={ref}
      className={cn(
        'fixed inset-0 z-50',
        glass
          ? 'glass-scope bg-gbg-deep/80 backdrop-blur-glass-md'
          : 'bg-neutral-900/60 backdrop-blur-sm',
        !prefersReducedMotion &&
          'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 duration-200',
        className
      )}
      {...props}
    />
  );
});
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    onEscapeKeyDown?: (e: KeyboardEvent) => void;
    glass?: boolean;
  }
>(({ className, children, onEscapeKeyDown, glass, ...props }, ref) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const prefersReducedMotion = usePrefersReducedMotion();

  // 焦点返回：关闭时返回到触发元素
  useFocusReturn(isOpen);

  // Escape 键关闭
  useEscapeKey(() => {
    if (isOpen && onEscapeKeyDown) {
      onEscapeKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }));
    }
  }, isOpen);

  React.useEffect(() => {
    setIsOpen(true);
    return () => setIsOpen(false);
  }, []);

  return (
    <DialogPortal>
      <DialogOverlay glass={glass} />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 p-6',
          glass
            ? // .glass-elevated 自带 border / radius / shadow，别再叠 Tailwind 的
              // shadow-modal 和 sm:rounded-lg，否则要靠源码顺序才能赢，太脆。
              // .glass-scope 必须加：Portal 挂到 <body>，跑出了 .theme-glass 子树。
              'glass-scope glass-elevated text-gtext-primary'
            : 'border border-neutral-200 bg-white shadow-modal sm:rounded-lg',
          !prefersReducedMotion &&
            'duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]',
          className
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          className={cn(
            'absolute right-4 top-4 rounded-md opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 disabled:pointer-events-none',
            glass
              ? 'focus:ring-gbrand-ring focus:ring-offset-0'
              : 'ring-offset-white focus:ring-primary focus:ring-offset-2'
          )}
        >
          <X className="h-4 w-4" />
          <span className="sr-only">关闭</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  );
});
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col space-y-2 text-center sm:text-left', className)} {...props} />
);
DialogHeader.displayName = 'DialogHeader';

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-lg font-semibold leading-none tracking-tight text-foreground', className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-sm text-fg-muted', className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...props} />
);
DialogFooter.displayName = 'DialogFooter';

export { Dialog, DialogPortal, DialogOverlay, DialogClose, DialogTrigger, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription };
