import type { ComponentPropsWithoutRef } from 'react';
import { cn } from './cn';

/** Inline text link classes — also for router `<Link className={linkClass}>`. */
export const linkClass = 'inline-flex min-h-11 items-center rounded-xs text-accent-text underline-offset-2 hover:underline active:text-(--accent-text-strong) tr-colors';

export interface LinkProps extends ComponentPropsWithoutRef<'a'> {
  href: string;
}

/** Plain anchor styled as an inline link (legal pages, shop links). `target="_blank"` gets rel="noopener noreferrer". */
export function Link({ className, target, rel, children, ...rest }: LinkProps) {
  const safeRel = target === '_blank' ? (rel ?? 'noopener noreferrer') : rel;
  return (
    <a className={cn(linkClass, className)} target={target} rel={safeRel} {...rest}>
      {children}
    </a>
  );
}
