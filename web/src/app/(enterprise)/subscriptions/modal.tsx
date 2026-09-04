'use client';

/**
 * 页面内小弹窗。
 *
 * 从 page.tsx 抽出来是因为拆表格组件后它被两处引用，
 * 与 components/ui/dialog 的区别是不带 Radix、不锁滚动 —— 这一页的
 * 四个弹窗都是「一句话确认 + 一个输入」，不需要那套。
 */
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 w-full max-w-sm rounded-xl border border-border bg-background shadow-lg">
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <h3 className="text-base font-semibold">{title}</h3>
          <button onClick={onClose} className="text-fg-muted hover:text-foreground">
            ✕
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
