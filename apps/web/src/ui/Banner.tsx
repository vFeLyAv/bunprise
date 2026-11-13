import type { ReactNode } from 'react';
import { cn } from './cn';
// by file: the shell's offline banner keeps the big icon module out of every initial bundle (ui/iconBase.tsx)
import { IconGlobe } from './iconGlobe';

export type BannerKind = 'info' | 'offline' | 'error';

export interface BannerProps {
  kind?: BannerKind;
  icon?: ReactNode;
  /** Small action on the right (ghost Button size "sm"). */
  action?: ReactNode;
  /** Sticks under the top bar while scrolling. */
  sticky?: boolean;
  className?: string;
  children: ReactNode;
}

const KIND: Record<BannerKind, string> = {
  info: 'bg-accent-50 text-text',
  offline: 'bg-surface-2 text-text-2 ring-1 ring-inset ring-separator',
  error: 'bg-danger-bg text-danger',
};

/** Thin status strip: "No connection – showing saved data" (S15), update available, inline errors. */
export function Banner({ kind = 'info', icon, action, sticky, className, children }: BannerProps) {
  const defaultIcon = kind === 'offline' ? <IconGlobe size={20} /> : null;
  return (
    <div
      role={kind === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex min-h-11 items-center gap-3 rounded-md px-4 py-2 t-subhead',
        KIND[kind],
        sticky && 'sticky top-[calc(var(--topbar-h)+var(--sa-top)+var(--sp-2))] z-(--z-sticky)',
        className,
      )}
    >
      {icon ?? defaultIcon ? <span className="shrink-0">{icon ?? defaultIcon}</span> : null}
      <div className="min-w-0 flex-1">{children}</div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
