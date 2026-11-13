import { useEffect, useRef, type ComponentPropsWithoutRef, type KeyboardEvent, type ReactNode } from 'react';
import * as m from 'motion/react-m';
import { cn } from './cn';
import { haptic } from './haptics';
import { useSpring, useTapScale } from './motion';

type NativeButtonProps = Omit<
  ComponentPropsWithoutRef<'button'>,
  'onAnimationStart' | 'onDrag' | 'onDragStart' | 'onDragEnd' | 'style' | 'children' | 'role'
>;

export interface ChipProps extends NativeButtonProps {
  selected?: boolean;
  /** 'button' = toggle (aria-pressed); 'radio' = one-of-many inside <ChipGroup> (aria-checked). */
  role?: 'button' | 'radio';
  icon?: ReactNode;
  children: ReactNode;
}

/** Selectable chip (§3): 36 px, --r-control (pill), selected = accent-100 fill + 1.5 px accent ring; tap area 44 px. */
export function Chip({
  selected = false,
  role = 'button',
  icon,
  className,
  type = 'button',
  disabled,
  tabIndex,
  onPointerDown,
  children,
  ...rest
}: ChipProps) {
  const tap = useTapScale(0.96);
  const spring = useSpring('snappy');
  const radio = role === 'radio';
  return (
    <m.button
      type={type}
      role={radio ? 'radio' : undefined}
      aria-checked={radio ? selected : undefined}
      aria-pressed={radio ? undefined : selected}
      tabIndex={radio ? (tabIndex ?? (selected ? 0 : -1)) : tabIndex}
      disabled={disabled}
      className={cn(
        'hit-expand inline-flex h-9 select-none items-center gap-1.5 whitespace-nowrap rounded-control px-3.5 text-subhead font-semibold tr-colors',
        'disabled:pointer-events-none disabled:opacity-40',
        selected ? 'bg-accent-100 text-text ring-[1.5px] ring-inset ring-accent-text' : 'bg-fill text-text',
        className,
      )}
      whileTap={disabled ? undefined : tap}
      transition={spring}
      onPointerDown={(e) => {
        if (!disabled) haptic('select');
        onPointerDown?.(e);
      }}
      {...rest}
    >
      {icon ? <span className="inline-flex [&>svg]:h-4 [&>svg]:w-4">{icon}</span> : null}
      {children}
    </m.button>
  );
}

export interface ChipGroupProps extends Omit<ComponentPropsWithoutRef<'div'>, 'role'> {
  /** Accessible name of the group (from i18n). */
  label: string;
}

/** radiogroup wrapper for `<Chip role="radio">`: arrow keys move, roving tabindex. */
export function ChipGroup({ label, className, children, onKeyDown, ...rest }: ChipGroupProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Keep at least one chip reachable by Tab when nothing is selected yet.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const radios = Array.from(el.querySelectorAll<HTMLElement>('[role="radio"]'));
    const first = radios[0];
    if (first && !radios.some((r) => r.tabIndex === 0)) first.tabIndex = 0;
  });

  const handleKey = (e: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(e);
    if (e.defaultPrevented) return;
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step || !ref.current) return;
    const radios = Array.from(ref.current.querySelectorAll<HTMLElement>('[role="radio"]:not(:disabled)'));
    const i = radios.findIndex((r) => r === document.activeElement);
    const next = radios[(i + step + radios.length) % radios.length];
    if (!next) return;
    e.preventDefault();
    next.focus();
    next.click();
  };

  return (
    <div ref={ref} role="radiogroup" aria-label={label} className={cn('flex flex-wrap gap-2', className)} onKeyDown={handleKey} {...rest}>
      {children}
    </div>
  );
}
