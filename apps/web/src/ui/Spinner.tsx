import { cn } from './cn';
import '../styles/kit.css';

export interface SpinnerProps {
  /** Accessible name (from i18n). Without it the spinner is decorative (aria-hidden). */
  label?: string;
  className?: string;
}

/** 16 px inline spinner — only inside buttons / status rows, never full screen (§2.6). */
export function Spinner({ label, className }: SpinnerProps) {
  return label ? (
    <span role="progressbar" aria-label={label} className={cn('spinner', className)} />
  ) : (
    <span aria-hidden="true" className={cn('spinner', className)} />
  );
}
