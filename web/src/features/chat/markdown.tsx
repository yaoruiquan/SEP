'use client';

import { memo, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import hljs from 'highlight.js';
import { cn } from '@/lib/utils';

/**
 * Markdown renderer for chat messages. Highlights code blocks after render.
 * `highlight.js/styles/github.css` is imported once in globals.css.
 */
function MarkdownImpl({ content, className }: { content: string; className?: string }) {
  useEffect(() => {
    // highlight any code blocks that appeared in the latest render
    document
      .querySelectorAll<HTMLElement>('.md-body pre code:not([data-highlighted])')
      .forEach((el) => {
        try {
          hljs.highlightElement(el);
        } catch {
          /* ignore */
        }
      });
  }, [content]);

  return (
    <div
      className={cn(
        'md-body markdown-body max-w-none text-[15px] leading-relaxed text-foreground',
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node, ...props }) => (
            <a
              {...props}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-2"
            />
          ),
          code: ({ node, className: cls, children, ...props }) => {
            const isBlock = /language-/.test(cls ?? '');
            if (isBlock) {
              return (
                <code className={cls} {...props}>
                  {children}
                </code>
              );
            }
            return (
              <code
                className="rounded bg-muted px-1.5 py-0.5 text-[13px] font-mono text-foreground"
                {...props}
              >
                {children}
              </code>
            );
          },
          pre: ({ node, children, ...props }) => (
            <pre
              className="my-3 overflow-x-auto rounded-lg border border-border bg-[#f7f7f6] p-3 text-[13px] scroll-thin"
              {...props}
            >
              {children}
            </pre>
          ),
          table: ({ node, ...props }) => (
            <div className="my-3 overflow-x-auto">
              <table className="w-full border-collapse text-sm" {...props} />
            </div>
          ),
          th: ({ node, ...props }) => (
            <th
              className="border border-border bg-muted px-3 py-1.5 text-left font-medium"
              {...props}
            />
          ),
          td: ({ node, ...props }) => (
            <td className="border border-border px-3 py-1.5" {...props} />
          ),
          ul: ({ node, ...props }) => (
            <ul className="my-2 list-disc space-y-1 pl-5" {...props} />
          ),
          ol: ({ node, ...props }) => (
            <ol className="my-2 list-decimal space-y-1 pl-5" {...props} />
          ),
          p: ({ node, ...props }) => <p className="my-2 first:mt-0 last:mb-0" {...props} />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export const Markdown = memo(MarkdownImpl);
