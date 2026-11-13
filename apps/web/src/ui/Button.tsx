import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import * as m from 'motion/react-m';
import { cn } from './cn';
// the floating glass (.glass-bar / .glass-sheet / .glass-float / .glass-toast) ships with the kit, not globally
import '../styles/glass.css';
import { haptic, type HapticKind } from './haptics';
import { useSpring, useTapScale } from './motion';
import { Spinner } from './Spinner';

/**
 * `glass` = a frosted pill (.glass-float) for controls over a scene or content (overlays);
 * `glass-accent` = the primary action in accent glass (.glass-float .glass-accent, like the "+" FAB) on a
 * glass card over the warm scene (start screen). Both turn solid under reduced transparency.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'glass' | 'glass-accent';
/** lg = 52 px full-width CTA · md = 44 px inline · sm = 36 px (tap area still 44 via hit-expand). */
export type ButtonSize = 'lg' | 'md' | 'sm';

export interface ButtonStyleOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
}

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-text-on-accent active:bg-accent-500',
  secondary: 'bg-fill text-text active:bg-fill-3',
  ghost: 'bg-transparent text-accent-text active:text-(--accent-text-strong)',
  destructive: 'bg-danger-fill text-white active:opacity-90',
  glass: 'glass-float text-text active:bg-fill-2',
  'glass-accent': 'glass-float glass-accent text-text-on-accent active:bg-accent-500',
};

const SIZE: Record<ButtonSize, string> = {
  lg: 'h-13 px-5 t-headline',
  md: 'h-11 px-4 t-headline',
  sm: 'h-9 px-3 text-subhead font-semibold hit-expand',
};

/** Class list of a button — also for router `<Link className={buttonClass(…)}>`. */
export function buttonClass({ variant = 'primary', size = 'md', fullWidth = false }: ButtonStyleOptions = {}): string {
  return cn(
    // --r-button (blocker 6): a pill by default; a theme can make every text button a rectangle
    'relative inline-flex select-none items-center justify-center gap-2 rounded-button whitespace-nowrap tr-colors',
    'disabled:pointer-events-none disabled:opacity-40',
    VARIANT[variant],
    SIZE[size],
    fullWidth && 'w-full',
  );
}

type NativeButtonProps = Omit<
  ComponentPropsWithoutRef<'button'>,
  'onAnimationStart' | 'onDrag' | 'onDragStart' | 'onDragEnd' | 'style' | 'children'
>;

export interface ButtonProps extends NativeButtonProps, ButtonStyleOptions {
  /** Shows a spinner, keeps the width, sets aria-busy and disables the button (§2.6). */
  loading?: boolean;
  /** Accessible name of the spinner while loading (from i18n). */
  loadingLabel?: string;
  /** 20 px icon on the left (decorative). */
  icon?: ReactNode;
  /** Haptic kind fired on pointer down; null = none. Default 'tap'. */
  hapticKind?: HapticKind | null;
  children?: ReactNode;
}

/**
 * The button (§3): --r-button shape (pill), spring press (scale .97, snappy), pressed colour,
 * loading state with fixed width. Text comes from the caller (i18n).
 */
export function Button({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  loading = false,
  loadingLabel,
  icon,
  hapticKind = 'tap',
  className,
  disabled,
  type = 'button',
  onPointerDown,
  children,
  ...rest
}: ButtonProps) {
  const tap = useTapScale(0.97);
  const spring = useSpring('snappy');
  const isDisabled = disabled || loading;
  return (
    <m.button
      type={type}
      className={cn(buttonClass({ variant, size, fullWidth }), className)}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      whileTap={isDisabled ? undefined : tap}
      transition={spring}
      onPointerDown={(e) => {
        if (hapticKind && !isDisabled) haptic(hapticKind);
        onPointerDown?.(e);
      }}
      {...rest}
    >
      <span className={cn('contents', loading && 'invisible')}>
        {icon ? <span className="inline-flex shrink-0 [&>svg]:h-5 [&>svg]:w-5">{icon}</span> : null}
        {children}
      </span>
      {loading ? (
        <span className="absolute inset-0 grid place-items-center">
          <Spinner label={loadingLabel} />
        </span>
      ) : null}
    </m.button>
  );
}

type NativeAnchorProps = Omit<
  ComponentPropsWithoutRef<'a'>,
  'onAnimationStart' | 'onDrag' | 'onDragStart' | 'onDragEnd' | 'style' | 'children'
>;

export interface ButtonLinkProps extends NativeAnchorProps, ButtonStyleOptions {
  icon?: ReactNode;
  children?: ReactNode;
}

/** A link that looks and presses like a Button (external links, legal pages). For router links use `buttonClass()`. */
export function ButtonLink({ variant = 'primary', size = 'md', fullWidth = false, icon, className, children, ...rest }: ButtonLinkProps) {
  const tap = useTapScale(0.97);
  const spring = useSpring('snappy');
  return (
    <m.a className={cn(buttonClass({ variant, size, fullWidth }), className)} whileTap={tap} transition={spring} {...rest}>
      {icon ? <span className="inline-flex shrink-0 [&>svg]:h-5 [&>svg]:w-5">{icon}</span> : null}
      {children}
    </m.a>
  );
}
