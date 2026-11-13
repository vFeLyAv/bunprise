/**
 * The icon factory (own drawings, 24×24 grid, 2 px round strokes) — shared by ui/icons.tsx and the few
 * icons that live in files of their own because an initial chunk needs them (ui/iconGlobe.tsx: the
 * shell's offline banner; ui/iconLink.tsx: the invite landing). Only those small files reach the
 * initial bundles; the big icon module stays in lazy chunks (perf audit 2026-10-20 §6.1).
 */
import type { SVGProps } from 'react';

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  /** CSS px; default 24. */
  size?: number;
}

export function makeIcon(name: string, d: string, filled = false) {
  function Icon({ size = 24, className, ...rest }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        className={className}
        {...rest}
      >
        <path d={d} />
      </svg>
    );
  }
  Icon.displayName = `Icon(${name})`;
  return Icon;
}
