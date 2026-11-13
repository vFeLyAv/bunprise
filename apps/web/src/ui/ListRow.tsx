import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from './cn';
import { haptic } from './haptics';
import { IconForward } from './icons';

/** Plain list container (no bullets). */
export function List({ className, children, ...rest }: ComponentPropsWithoutRef<'ul'>) {
  return (
    <ul className={cn('m-0 list-none p-0', className)} {...rest}>
      {children}
    </ul>
  );
}

/** The <li> with the inset separator (16 px from the left, none on the first row). */
export const listItemClass =
  "relative before:absolute before:left-4 before:right-0 before:top-0 before:h-px before:bg-separator before:content-[''] first:before:hidden";

/** The pressable row surface: 56 px (one line) / 72 px (two lines or thumbnail). Pressed = --fill-2, no scale (§3). */
export function listRowClass(opts: { tall?: boolean; pressable?: boolean; disabled?: boolean } = {}): string {
  return cn(
    'flex w-full items-center gap-3 px-4 py-3 text-left text-text tr-colors',
    opts.tall ? 'min-h-18' : 'min-h-14',
    opts.pressable && 'active:bg-fill-2',
    opts.disabled && 'pointer-events-none opacity-50',
  );
}

export interface ListRowContentProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** 56×56 thumbnail, avatar or icon. */
  leading?: ReactNode;
  /** Badge, price, switch … */
  trailing?: ReactNode;
  chevron?: boolean;
}

/** Row content without the wrapper — use inside a router `<Link className={listRowClass(...)}>`. */
export function ListRowContent({ title, subtitle, leading, trailing, chevron }: ListRowContentProps) {
  return (
    <>
      {leading ? <span className="shrink-0">{leading}</span> : null}
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 block t-headline hyphens-auto [overflow-wrap:anywhere]">{title}</span>
        {subtitle ? <span className="mt-0.5 line-clamp-2 block t-subhead text-text-2 [overflow-wrap:anywhere]">{subtitle}</span> : null}
      </span>
      {trailing ? <span className="shrink-0">{trailing}</span> : null}
      {chevron ? <IconForward size={16} className="shrink-0 text-text-3" /> : null}
    </>
  );
}

export interface ListRowProps extends ListRowContentProps {
  /** Makes the row a button. */
  onPress?: () => void;
  /** Makes the row a plain anchor (external links). For routes use `listRowClass` + router Link. */
  href?: string;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
}

/** List row (§3): whole row is the control; separator inset 16; title clamps at 2 lines. */
export function ListRow({ onPress, href, disabled, className, title, subtitle, leading, trailing, chevron, ...aria }: ListRowProps) {
  const tall = Boolean(subtitle || leading);
  const inner = listRowClass({ tall, pressable: Boolean(onPress || href), disabled });
  const content = <ListRowContent title={title} subtitle={subtitle} leading={leading} trailing={trailing} chevron={chevron} />;
  return (
    <li className={cn(listItemClass, className)}>
      {href ? (
        <a href={href} className={inner} aria-disabled={disabled || undefined} {...aria}>
          {content}
        </a>
      ) : onPress ? (
        <button type="button" className={inner} disabled={disabled} onPointerDown={() => haptic('tap')} onClick={onPress} {...aria}>
          {content}
        </button>
      ) : (
        <div className={inner} {...aria}>
          {content}
        </div>
      )}
    </li>
  );
}
