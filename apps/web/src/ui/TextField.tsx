import { useId, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { cn } from './cn';
import { controlClass, describedBy, FieldShell } from './Field';
import { IconButton } from './IconButton';
import { IconX } from './icons';

export interface TextFieldProps extends Omit<ComponentPropsWithoutRef<'input'>, 'id' | 'className'> {
  id?: string;
  label: ReactNode;
  hint?: ReactNode;
  /** Error text (from i18n). Sets aria-invalid + aria-describedby. */
  error?: ReactNode;
  /** Shows a 44 px "×" button when the field has a value. */
  clearable?: { label: string; onClear: () => void };
  leading?: ReactNode;
  trailing?: ReactNode;
  className?: string;
  /** Extra classes of the input itself, e.g. `otpInputClass` for the one-time code. */
  inputClassName?: string;
}

/**
 * Text input (§3): label 13 px above, 48 px box, focus border --accent-text,
 * error border + footnote. For e-mail use type="email" inputMode="email"
 * autoComplete="email"; for the OTP code use inputMode="numeric"
 * autoComplete="one-time-code" and the `otp` class below.
 */
export function TextField({ id: idProp, label, hint, error, clearable, leading, trailing, className, inputClassName, disabled, value, ...rest }: TextFieldProps) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const hasValue = value !== undefined && value !== null && String(value).length > 0;
  return (
    <FieldShell
      id={id}
      label={label}
      hint={hint}
      error={error}
      disabled={disabled}
      leading={leading}
      className={className}
      trailing={
        <>
          {clearable && hasValue && !disabled ? (
            <IconButton label={clearable.label} variant="plain" className="-mr-2" onClick={clearable.onClear} hapticKind="select">
              <IconX size={20} />
            </IconButton>
          ) : null}
          {trailing}
        </>
      }
    >
      <input
        id={id}
        className={cn(controlClass, 'h-full', inputClassName)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        disabled={disabled}
        value={value}
        {...rest}
      />
    </FieldShell>
  );
}

/** Extra classes for the one-time-code field: 28/600, letter-spacing .3em, centred (§3 OtpField). */
export const otpInputClass = 'text-center text-title-1 font-semibold tracking-[0.3em] tabular-nums';
