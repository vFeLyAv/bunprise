import { cn } from './cn';

export interface DividerProps {
  /** 16 px inset from the left (list style). */
  inset?: boolean;
  className?: string;
}

/** Hairline in --separator. */
export function Divider({ inset, className }: DividerProps) {
  return <hr className={cn('m-0 border-0 border-t border-separator', inset && 'ml-4', className)} />;
}
