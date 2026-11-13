import { cn } from './cn';
import '../styles/kit.css';

const ROUND = { sm: 'rounded-sm', md: 'rounded-md', lg: 'rounded-lg', full: 'rounded-full' } as const;

export interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  rounded?: keyof typeof ROUND;
  className?: string;
}

/** One grey block (--fill-2, --r-sm) that pulses; static under reduce motion (§2.6). Decorative. */
export function Skeleton({ width = '100%', height = 16, rounded = 'sm', className }: SkeletonProps) {
  return <div aria-hidden="true" className={cn('skeleton', ROUND[rounded], className)} style={{ width, height }} />;
}

export interface SkeletonListProps {
  /** Feed: 4 × 72; wishlist: 3 × 72 (§2.6). */
  rows?: number;
  rowHeight?: number;
  /** 'rows' mimics list rows (circle + two lines); 'blocks' = plain blocks. */
  variant?: 'rows' | 'blocks';
  gap?: number;
  className?: string;
}

/** Placeholder list with the exact height of the real rows, so nothing jumps (CLS 0). */
export function SkeletonList({ rows = 4, rowHeight = 72, variant = 'rows', gap = 0, className }: SkeletonListProps) {
  return (
    <div aria-busy="true" className={cn('flex flex-col', className)} style={{ gap }}>
      {Array.from({ length: rows }, (_, i) =>
        variant === 'rows' ? (
          <div key={i} aria-hidden="true" className="flex items-center gap-3 px-4" style={{ height: rowHeight }}>
            <Skeleton width={40} height={40} rounded="full" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton height={14} width="62%" />
              <Skeleton height={12} width="38%" />
            </div>
          </div>
        ) : (
          <Skeleton key={i} height={rowHeight} />
        ),
      )}
    </div>
  );
}
