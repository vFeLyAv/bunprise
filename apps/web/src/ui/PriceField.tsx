import { useId, useState, type ReactNode } from 'react';
import { cn } from './cn';
import { controlClass, describedBy, FieldShell } from './Field';

export const PRICE_MAX_CENTS = 99_999_999; // 999 999,99 €

export interface PriceFieldProps {
  id?: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Whole cents (EUR); null = no price. */
  value: number | null;
  /** Called on blur with parsed cents; `invalid` = text was not a number (value stays unchanged, text is kept). */
  onChange: (cents: number | null, meta: { invalid: boolean }) => void;
  /** BCP 47 tag for separators; default: document language. */
  locale?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  name?: string;
  autoFocus?: boolean;
}

function currentLocale(): string {
  if (typeof document !== 'undefined' && document.documentElement.lang) return document.documentElement.lang;
  if (typeof navigator !== 'undefined' && navigator.language) return navigator.language;
  return 'de';
}

/** 1250 → "12,50" (de) / "12.50" (en). Plain number: the "€" is a static suffix. */
export function formatCents(cents: number | null, locale = currentLocale()): string {
  if (cents === null || !Number.isFinite(cents)) return '';
  return new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false }).format(cents / 100);
}

/** Accepts "12,50", "12.50", "12", " 12,5 €". Returns null for empty, NaN for garbage. */
export function parseCents(text: string): number | null {
  const normalized = text.replace(/[\s€]/g, '').replace(',', '.');
  if (normalized === '') return null;
  if (!/^\d{1,6}(\.\d{0,2})?$/.test(normalized)) return Number.NaN;
  const cents = Math.round(Number(normalized) * 100);
  return cents > PRICE_MAX_CENTS ? Number.NaN : cents;
}

/**
 * Price in EUR (§3): inputmode decimal, "," and "." both work, parsed on blur,
 * stored as whole cents, tabular digits. Negative or absurd → invalid.
 */
export function PriceField({
  id: idProp,
  label,
  hint,
  error,
  value,
  onChange,
  locale,
  placeholder,
  disabled,
  className,
  name,
  autoFocus,
}: PriceFieldProps) {
  const autoId = useId();
  const id = idProp ?? autoId;
  // While editing, the field shows local text; otherwise it derives from `value`
  // (or keeps the rejected text so the user can correct it).
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const [rejected, setRejected] = useState<string | null>(null);
  const shown = focused ? text : (rejected ?? formatCents(value, locale));

  const commit = () => {
    const parsed = parseCents(text);
    if (parsed !== null && Number.isNaN(parsed)) {
      setRejected(text);
      onChange(value, { invalid: true });
      return;
    }
    setRejected(null);
    onChange(parsed, { invalid: false });
  };

  return (
    <FieldShell
      id={id}
      label={label}
      hint={hint}
      error={error}
      disabled={disabled}
      className={className}
      trailing={
        <span aria-hidden="true" className="t-body text-text-2">
          €
        </span>
      }
    >
      <input
        id={id}
        name={name}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        className={cn(controlClass, 'h-full tabular-nums')}
        value={shown}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => {
          setText(rejected ?? formatCents(value, locale));
          setFocused(true);
        }}
        onBlur={() => {
          setFocused(false);
          commit();
        }}
      />
    </FieldShell>
  );
}
