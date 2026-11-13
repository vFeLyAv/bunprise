import { useId, type ReactNode } from 'react';
import * as m from 'motion/react-m';
import { cn } from './cn';
import { haptic } from './haptics';
import { useSpring } from './motion';

export interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Visible label (row layout). Without it pass aria-label. */
  label?: ReactNode;
  description?: ReactNode;
  /** Row layout only: something before the label, e.g. an <IconTile> (grouped settings rows). */
  leading?: ReactNode;
  'aria-label'?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
}

/** iOS-style switch (§3): track 51×31, knob 27; on = the orange --switch-on with a darker inset rim (--switch-on-rim, the 3:1 boundary against a card, blocker 7); role="switch". */
export function Switch({ checked, onChange, label, description, leading, 'aria-label': ariaLabel, disabled, id: idProp, className }: SwitchProps) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const descId = `${id}-desc`;
  const spring = useSpring('snappy');

  const control = (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={label ? undefined : ariaLabel}
      aria-describedby={description ? descId : undefined}
      disabled={disabled}
      onClick={() => {
        haptic('select');
        onChange(!checked);
      }}
      className={cn(
        'hit-expand relative h-[31px] w-[51px] shrink-0 rounded-full tr-colors disabled:opacity-40',
        checked ? 'bg-switch-on shadow-[inset_0_0_0_1.5px_var(--switch-on-rim)]' : 'bg-fill-3',
        !label && className,
      )}
    >
      <m.span
        aria-hidden="true"
        className="absolute left-0.5 top-0.5 block h-[27px] w-[27px] rounded-full bg-white elev-1"
        initial={false}
        animate={{ x: checked ? 20 : 0 }}
        transition={spring}
      />
    </button>
  );

  if (!label) return control;
  return (
    <label className={cn('flex min-h-11 cursor-pointer items-center justify-between gap-4', disabled && 'opacity-50', className)}>
      {leading ? <span className="-mr-1 shrink-0 self-start pt-0.5">{leading}</span> : null}
      <span className="min-w-0 flex-1">
        <span className="block t-body text-text">{label}</span>
        {description ? (
          <span id={descId} className="block t-footnote text-text-2">
            {description}
          </span>
        ) : null}
      </span>
      {control}
    </label>
  );
}
