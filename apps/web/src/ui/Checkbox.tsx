import type { ChangeEvent, ReactNode } from 'react';
import * as m from 'motion/react-m';
import { cn } from './cn';
import '../styles/kit.css';
import { haptic } from './haptics';
import { useSpring } from './motion';

export interface CheckboxProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** The text next to the box (it may contain links). */
  children: ReactNode;
  disabled?: boolean;
  className?: string;
}

/**
 * A checkbox row (wave 1): the real <input type="checkbox"> (keyboard, forms, screen readers, tests) sits
 * invisibly on a 22 px frosted box that fills with the accent and draws its tick with the bouncy spring.
 * The whole row is the label (≥ 44 px tall).
 */
export function Checkbox({ checked, onChange, children, disabled, className }: CheckboxProps) {
  const bouncy = useSpring('bouncy');
  return (
    <label className={cn('flex min-h-11 cursor-pointer items-start gap-3 py-2 t-footnote text-text', disabled && 'cursor-default opacity-50', className)}>
      <span className="relative -mt-px grid size-5.5 shrink-0 place-items-center">
        <input
          type="checkbox"
          className="peer absolute inset-0 m-0 h-full w-full cursor-pointer appearance-none rounded-xs disabled:cursor-default"
          checked={checked}
          disabled={disabled}
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            haptic('select');
            onChange(event.target.checked);
          }}
        />
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute inset-0 rounded-xs tr-colors peer-focus-visible:[box-shadow:inset_0_0_0_2px_var(--accent-text),var(--ring)]',
            checked ? 'bg-accent' : 'glass-field',
          )}
        />
        <m.svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="pointer-events-none relative h-4 w-4 text-text-on-accent"
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={false}
          animate={{ scale: checked ? 1 : 0.4, opacity: checked ? 1 : 0 }}
          transition={{ ...bouncy, opacity: { duration: 0.12 } }}
        >
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </m.svg>
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </label>
  );
}
