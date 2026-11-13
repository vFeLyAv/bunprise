import { useId, useState, type ChangeEvent, type ReactNode } from 'react';
import * as m from 'motion/react-m';
import { cn } from './cn';
import '../styles/kit.css';
import { describedBy, fieldIds } from './Field';
import { useSpring } from './motion';
import '../styles/otp.css';

export interface OtpFieldProps {
  label: ReactNode;
  /** digits only, at most `length` */
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  length?: number;
  disabled?: boolean;
  error?: ReactNode;
  hint?: ReactNode;
  id?: string;
  autoFocus?: boolean;
}

/**
 * The one-time code as six frosted slots (wave 1): one real <input> (one-time-code autofill, paste, the
 * numeric keypad, screen readers, tests) lies transparent over six boxes that show the digits; the slot
 * that takes the next digit glows with the accent rim and a blinking caret; a typed digit pops in (bouncy).
 */
export function OtpField({ label, value, onChange, length = 6, disabled, error, hint, id: idProp, autoFocus }: OtpFieldProps) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const { hintId, errorId } = fieldIds(id);
  const [focused, setFocused] = useState(false);
  const bouncy = useSpring('bouncy');
  const digits = value.slice(0, length).split('');
  const active = Math.min(digits.length, length - 1);
  return (
    <div className={cn('flex flex-col', disabled && 'opacity-50')}>
      <label htmlFor={id} className="mb-1 t-footnote text-text-2">
        {label}
      </label>
      <div className="relative">
        <div aria-hidden="true" className="grid gap-2" style={{ gridTemplateColumns: `repeat(${length}, minmax(0, 1fr))` }}>
          {Array.from({ length }, (_, i) => {
            const digit = digits[i];
            const isActive = focused && i === active && !disabled;
            return (
              <span
                key={i}
                data-invalid={error ? '' : undefined}
                data-active={isActive ? '' : undefined}
                className="glass-field otp-slot relative grid h-14 place-items-center rounded-md text-title-2 font-bold tabular-nums text-text tr-colors"
              >
                {digit ? (
                  <m.span key={`${i}-${digit}`} initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ ...bouncy, opacity: { duration: 0.1 } }}>
                    {digit}
                  </m.span>
                ) : isActive ? (
                  <span className="otp-caret h-6 w-0.5 rounded-full bg-accent-text" />
                ) : null}
              </span>
            );
          })}
        </div>
        <input
          autoFocus={autoFocus}
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern={`[0-9]{${length}}`}
          maxLength={length}
          required
          value={value}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, hint, error)}
          onChange={onChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className="absolute inset-0 h-full w-full cursor-text rounded-md bg-transparent text-transparent caret-transparent outline-none selection:bg-transparent focus-visible:shadow-none"
        />
      </div>
      {error ? (
        <p id={errorId} className="mt-1 t-footnote text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="mt-1 t-footnote text-text-2">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
