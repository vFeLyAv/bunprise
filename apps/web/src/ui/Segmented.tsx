import type { KeyboardEvent, ReactNode } from 'react';
import * as m from 'motion/react-m';
import { cn } from './cn';
import { haptic } from './haptics';
import { fade, useSpring } from './motion';

/** The thumb's colour while this option is chosen (RSVP: going = ok green, maybe = accent, no = neutral). */
export type SegmentedTone = 'neutral' | 'ok' | 'accent';

export interface SegmentedOption<V extends string> {
  value: V;
  label: ReactNode;
  icon?: ReactNode;
  /** Colour of the thumb and the label while this option is selected. Default 'neutral' (white thumb). */
  tone?: SegmentedTone;
}

export interface SegmentedProps<V extends string> {
  options: ReadonlyArray<SegmentedOption<V>>;
  /** A value that is not one of the options = nothing selected (no indicator; the first option is tabbable). */
  value: V;
  onChange: (value: V) => void;
  /** Accessible name of the group (from i18n), e.g. "RSVP". */
  label: string;
  disabled?: boolean;
  className?: string;
}

const THUMB: Record<SegmentedTone, string> = {
  neutral: 'bg-(--thumb)',
  ok: 'bg-ok-bg',
  accent: 'bg-accent-100',
};
const SELECTED_TEXT: Record<SegmentedTone, string> = {
  neutral: 'text-text',
  ok: 'text-ok',
  accent: 'text-accent-text',
};

/**
 * Segmented control for 2–3 options (RSVP: going / maybe / not going).
 * radiogroup + arrow keys; the indicator slides with the snappy spring (its colour follows the chosen
 * option's `tone`), the chosen option's icon pops (bouncy). Track --r-control, thumb and segments
 * --r-control-inner (4 px inside the track: concentric, blocker 18).
 * With no matching value nothing is selected: the indicator fades out, Tab reaches the first
 * option and the arrow keys start from the first (→) or the last (←) option. That state asks for an
 * answer ("Kommst du?", blocker 12): a stronger track and every label in full ink, so it never reads as
 * disabled.
 */
export function Segmented<V extends string>({ options, value, onChange, label, disabled, className }: SegmentedProps<V>) {
  const spring = useSpring('snappy');
  const bouncy = useSpring('bouncy');
  const n = Math.max(options.length, 1);
  const found = options.findIndex((o) => o.value === value);
  const hasSelection = found >= 0;
  const index = Math.max(0, found);
  const tone = options[index]?.tone ?? 'neutral';

  const handleKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    const from = hasSelection ? index : step > 0 ? -1 : n;
    const target = (from + step + n) % n;
    const next = options[target];
    if (!next) return;
    e.preventDefault();
    onChange(next.value);
    const el = e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')[target];
    el?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      data-selection={hasSelection ? undefined : 'none'}
      className={cn(
        'relative grid h-[52px] rounded-control p-1 tr-colors',
        hasSelection ? 'bg-fill' : 'bg-fill-2',
        disabled && 'pointer-events-none opacity-50',
        className,
      )}
      style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
      onKeyDown={handleKey}
    >
      <m.span
        aria-hidden="true"
        className={cn('absolute bottom-1 left-1 top-1 rounded-control-inner elev-1 tr-colors', THUMB[tone])}
        style={{ width: `calc((100% - 0.5rem) / ${n})` }}
        initial={false}
        animate={{ x: `${index * 100}%`, opacity: hasSelection ? 1 : 0 }}
        transition={{ ...spring, opacity: fade }}
      />
      {options.map((o, i) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected || (!hasSelection && i === 0) ? 0 : -1}
            disabled={disabled}
            className={cn(
              'relative z-10 inline-flex items-center justify-center gap-1.5 rounded-control-inner px-2 text-subhead font-semibold tr-colors',
              selected ? SELECTED_TEXT[o.tone ?? 'neutral'] : !hasSelection ? 'text-text' : 'text-text-2',
            )}
            onClick={() => {
              if (selected) return;
              haptic('select');
              onChange(o.value);
            }}
          >
            {o.icon ? (
              <m.span
                className="inline-flex [&>svg]:h-4 [&>svg]:w-4"
                initial={false}
                animate={{ scale: selected ? 1.12 : 1 }}
                transition={bouncy}
              >
                {o.icon}
              </m.span>
            ) : null}
            <span className="truncate">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
