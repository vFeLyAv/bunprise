import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import * as m from 'motion/react-m';
import { cn } from './cn';
// the floating glass (.glass-bar / .glass-sheet / .glass-float / .glass-toast) ships with the kit, not globally
import '../styles/glass.css';
import { haptic, type HapticKind } from './haptics';
import { useSpring, useTapScale } from './motion';

/** `accent` = the "+" FAB: accent glass (.glass-float .glass-accent); `glass` = a small neutral glass control. */
export type IconButtonVariant = 'plain' | 'filled' | 'accent' | 'glass';

type NativeButtonProps = Omit<
  ComponentPropsWithoutRef<'button'>,
  'onAnimationStart' | 'onDrag' | 'onDragStart' | 'onDragEnd' | 'style' | 'children' | 'aria-label'
>;

export interface IconButtonProps extends NativeButtonProps {
  /** Required accessible name (from i18n) — the icon alone says nothing. */
  label: string;
  variant?: IconButtonVariant;
  /** 44 (default) or 56 (FAB). */
  size?: 44 | 56;
  hapticKind?: HapticKind | null;
  /** The icon (24 px; 28 px in the FAB size). */
  children: ReactNode;
}

const VARIANT: Record<IconButtonVariant, string> = {
  plain: 'bg-transparent text-text active:bg-fill-2',
  filled: 'bg-fill text-text active:bg-fill-2',
  accent: 'glass-float glass-accent text-text-on-accent active:bg-accent-500',
  glass: 'glass-float text-text active:bg-fill-2',
};

/** 44×44 icon-only button (§3). `size={56}` + variant "accent" = the FAB (floating accent glass). */
export function IconButton({
  label,
  variant = 'plain',
  size = 44,
  hapticKind = 'tap',
  className,
  disabled,
  type = 'button',
  onPointerDown,
  children,
  ...rest
}: IconButtonProps) {
  const tap = useTapScale(0.94);
  const spring = useSpring('snappy');
  return (
    <m.button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full tr-colors',
        'disabled:pointer-events-none disabled:opacity-40',
        size === 56 ? 'h-14 w-14 [&>svg]:h-7 [&>svg]:w-7' : 'h-11 w-11 [&>svg]:h-6 [&>svg]:w-6',
        VARIANT[variant],
        className,
      )}
      disabled={disabled}
      whileTap={disabled ? undefined : tap}
      transition={spring}
      onPointerDown={(e) => {
        if (hapticKind && !disabled) haptic(hapticKind);
        onPointerDown?.(e);
      }}
      {...rest}
    >
      {children}
    </m.button>
  );
}
