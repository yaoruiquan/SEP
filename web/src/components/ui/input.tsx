import * as React from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
  errorMessage?: string;
  glass?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, error, errorMessage, glass, ...props }, ref) => (
    <div className="w-full">
      <input
        type={type}
        ref={ref}
        className={cn(
          'flex h-10 w-full rounded border px-3 py-2 text-sm transition-colors',
          'placeholder:text-fg-subtle',
          'disabled:cursor-not-allowed disabled:opacity-50',
          glass
            ? [
                'bg-glass-2 text-gtext-primary border-glassline backdrop-blur-glass-sm',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gbrand-ring focus-visible:border-glassline-brand focus-visible:bg-glass-3',
                'disabled:bg-glass-1',
                error
                  ? 'border-gdanger focus-visible:ring-gdanger/40 focus-visible:border-gdanger'
                  : '',
              ]
            : [
                'bg-white',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-primary',
                'disabled:bg-neutral-50',
                error
                  ? 'border-danger focus-visible:ring-danger/20 focus-visible:border-danger'
                  : 'border-border',
              ],
          className
        )}
        aria-invalid={error ? 'true' : 'false'}
        aria-describedby={errorMessage ? 'input-error' : undefined}
        {...props}
      />
      {errorMessage && (
        <p id="input-error" className="mt-1.5 text-xs text-danger">
          {errorMessage}
        </p>
      )}
    </div>
  )
);
Input.displayName = 'Input';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  glass?: boolean;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, glass, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'flex w-full rounded border px-3 py-2 text-sm resize-none',
        'placeholder:text-fg-subtle disabled:cursor-not-allowed disabled:opacity-50',
        glass
          ? [
              'bg-glass-2 text-gtext-primary border-glassline backdrop-blur-glass-sm',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gbrand-ring focus-visible:border-glassline-brand focus-visible:bg-glass-3',
              'disabled:bg-glass-1',
            ]
          : [
              'bg-white border-border',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-primary',
            ],
        className,
      )}
      {...props}
    />
  )
);
Textarea.displayName = 'Textarea';
