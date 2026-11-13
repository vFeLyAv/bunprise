import { useId, type ComponentPropsWithoutRef, type InputEvent, type ReactNode } from 'react';
import { cn } from './cn';
import { controlClass, describedBy, FieldShell } from './Field';

export interface TextAreaProps extends Omit<ComponentPropsWithoutRef<'textarea'>, 'id' | 'className'> {
  id?: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Max visible rows before it scrolls. Default 6. */
  maxRows?: number;
  className?: string;
}

const supportsFieldSizing =
  typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('field-sizing', 'content');

/** Multi-line input that grows with its content up to `maxRows` (§3): `field-sizing: content`, JS fallback otherwise. */
export function TextArea({ id: idProp, label, hint, error, maxRows = 6, className, disabled, rows = 3, onInput, ...rest }: TextAreaProps) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const handleInput = (e: InputEvent<HTMLTextAreaElement>) => {
    if (!supportsFieldSizing) {
      const el = e.currentTarget;
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }
    onInput?.(e);
  };
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} disabled={disabled} multiline className={className}>
      <textarea
        id={id}
        rows={rows}
        className={cn(controlClass, 'resize-none py-3 [field-sizing:content]')}
        style={{ maxHeight: `calc(${maxRows} * var(--lh-body) + 1.5rem)` }}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        disabled={disabled}
        onInput={handleInput}
        {...rest}
      />
    </FieldShell>
  );
}
