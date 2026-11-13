import type { ReactNode } from 'react';
import { cn } from './cn';
import '../styles/kit.css';

/** Shared chrome of all form fields: label above, 48 px box, hint or error below. */
export interface FieldShellProps {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  disabled?: boolean;
  /** Something inside the box after the control (clear button, "€" suffix). */
  trailing?: ReactNode;
  leading?: ReactNode;
  /** Lets a textarea grow: the box is not fixed to 48 px. */
  multiline?: boolean;
  className?: string;
  children: ReactNode;
}

export function fieldIds(id: string) {
  return { hintId: `${id}-hint`, errorId: `${id}-error` };
}

export function FieldShell({ id, label, hint, error, disabled, trailing, leading, multiline, className, children }: FieldShellProps) {
  const { hintId, errorId } = fieldIds(id);
  return (
    <div className={cn('flex flex-col', disabled && 'opacity-50', className)}>
      <label htmlFor={id} className="mb-1 t-footnote text-text-2">
        {label}
      </label>
      <div
        // frosted input (.glass-field, app.css): the light inset rim; focus = accent rim, error = danger rim
        data-invalid={error ? '' : undefined}
        className={cn('glass-field flex items-center gap-2 rounded-md px-3 tr-colors', multiline ? 'min-h-12' : 'h-12')}
      >
        {leading}
        {children}
        {trailing}
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

/** aria-describedby value for the control inside a FieldShell. */
export function describedBy(id: string, hint: unknown, error: unknown): string | undefined {
  const { hintId, errorId } = fieldIds(id);
  if (error) return errorId;
  if (hint) return hintId;
  return undefined;
}

/** Classes of the bare control inside the shell (font ≥ 16 px: iOS does not zoom). */
export const controlClass =
  'min-w-0 flex-1 bg-transparent text-body text-text placeholder:text-text-3 outline-none focus-visible:shadow-none';
