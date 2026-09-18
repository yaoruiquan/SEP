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
  indigo: 'from-gbrand/10 via-card to-card',
  blue: 'from-ginfo/10 via-card to-card',
  violet: 'from-gbrand/15 via-card to-card',
  teal: 'from-gsuccess/10 via-card to-card',
};

export function PageHero({ title, description, eyebrow, actions, illustration, tone = 'indigo' }: PageHeroProps) {
  if (!illustration) {
    return (
      <header className="flex flex-col gap-4 py-2 sm:flex-row sm:items-end sm:justify-between sm:gap-6 sm:py-3">
        <div className="min-w-0">
          {eyebrow && <p className="mb-2 text-xs font-medium tracking-wide text-gbrand-text">{eyebrow}</p>}
          <h1 className="text-2xl font-semibold leading-tight tracking-tight text-foreground sm:text-[28px]">{title}</h1>
          {description && <p className="mt-2 max-w-2xl text-sm leading-6 text-fg-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 sm:shrink-0">{actions}</div>}
      </header>
    );
  }
  return (
    <section className={cn('relative min-h-[236px] overflow-hidden rounded-2xl border border-border bg-card bg-gradient-to-br px-6 pb-32 pt-6 sm:min-h-[184px] sm:px-8 sm:py-7', tones[tone])}>
      {illustration && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 sm:inset-y-0 sm:left-auto sm:h-full sm:w-[46%]">
          <Image
            src={illustration.src}
            alt={illustration.alt}
            fill
            sizes="(max-width: 640px) 100vw, 600px"
            className="object-cover object-center sm:object-right"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-card via-card/35 to-transparent sm:bg-gradient-to-r sm:via-card/70" />
        </div>
      )}
      <div className="relative z-10 max-w-full sm:max-w-[56%]">
        {eyebrow && <p className="mb-2 text-xs font-semibold tracking-wide text-gbrand-text">{eyebrow}</p>}
        <h1 className="text-2xl font-semibold leading-tight tracking-tight text-foreground sm:text-[28px]">{title}</h1>
        {description && <p className="mt-2 max-w-xl text-sm leading-6 text-fg-muted">{description}</p>}
        {actions && <div className="mt-5 flex flex-wrap items-center gap-3">{actions}</div>}
      </div>
    </section>
  );
}
