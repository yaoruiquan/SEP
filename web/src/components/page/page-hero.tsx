import Image from 'next/image';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type PageHeroProps = {
  title: string;
  description?: string;
  eyebrow?: string;
  actions?: ReactNode;
  illustration?: { src: string; alt: string };
  tone?: 'indigo' | 'blue' | 'violet' | 'teal';
};

const tones = {
  indigo: 'from-indigo-50 via-white to-white dark:from-indigo-950/35 dark:via-slate-950 dark:to-slate-950',
  blue: 'from-blue-50 via-white to-white dark:from-blue-950/35 dark:via-slate-950 dark:to-slate-950',
  violet: 'from-violet-50 via-white to-white dark:from-violet-950/35 dark:via-slate-950 dark:to-slate-950',
  teal: 'from-teal-50 via-white to-white dark:from-teal-950/35 dark:via-slate-950 dark:to-slate-950',
};

export function PageHero({ title, description, eyebrow, actions, illustration, tone = 'indigo' }: PageHeroProps) {
  if (!illustration) {
    return (
      <header className="py-3 sm:py-4">
        {eyebrow && <p className="mb-2 text-sm font-medium text-fg-muted">{eyebrow}</p>}
        <h1 className="text-[28px] font-semibold leading-tight text-foreground">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-sm leading-6 text-fg-muted">{description}</p>}
        {actions && <div className="mt-5 flex flex-wrap items-center gap-3">{actions}</div>}
      </header>
    );
  }
  return (
    <section className={cn('relative min-h-[236px] overflow-hidden rounded-2xl border border-indigo-100/80 bg-gradient-to-br px-6 pb-32 pt-6 shadow-sm sm:min-h-[184px] sm:px-8 sm:py-7 dark:border-white/10', tones[tone])}>
      {illustration && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 sm:inset-y-0 sm:left-auto sm:h-full sm:w-[46%]">
          <Image
            src={illustration.src}
            alt={illustration.alt}
            fill
            sizes="(max-width: 640px) 100vw, 600px"
            className="object-cover object-center sm:object-right"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-white via-white/35 to-transparent sm:bg-gradient-to-r sm:from-white sm:via-white/70 sm:to-transparent dark:from-slate-950 dark:via-slate-950/65 dark:to-transparent" />
        </div>
      )}
      <div className="relative z-10 max-w-full sm:max-w-[56%]">
        {eyebrow && <p className="mb-2 text-xs font-semibold tracking-[0.12em] text-indigo-600 dark:text-indigo-300">{eyebrow}</p>}
        <h1 className="text-[28px] font-semibold leading-tight text-slate-950 dark:text-white">{title}</h1>
        {description && <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600 dark:text-slate-300">{description}</p>}
        {actions && <div className="mt-5 flex flex-wrap items-center gap-3">{actions}</div>}
      </div>
    </section>
  );
}
