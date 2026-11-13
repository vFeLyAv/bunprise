import type { ReactNode } from 'react';
import { cn } from './cn';

export interface EmptyStateProps {
  /** Usually `<Mascot kind=… size="m" />`. Keeps its own a11y (the text next to it carries the meaning). */
  mascot?: ReactNode;
  title: ReactNode;
  text?: ReactNode;
  /** One primary CTA. */
  action?: ReactNode;
  className?: string;
}

/** Empty screen (§3): mascot 160 px + title-2 + one line + one CTA, --sp-10 vertical rhythm. */
export function EmptyState({ mascot, title, text, action, className }: EmptyStateProps) {
  return (
    <section className={cn('flex flex-col items-center gap-3 px-4 py-10 text-center', className)}>
      {mascot ? <div className="mb-2 flex justify-center">{mascot}</div> : null}
      <h2 className="t-title-2 text-text">{title}</h2>
      {text ? <p className="max-w-[32ch] t-body text-text-2">{text}</p> : null}
      {action ? <div className="mt-3 w-full max-w-xs">{action}</div> : null}
    </section>
  );
}
