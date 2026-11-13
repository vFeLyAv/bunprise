import type { ReactNode } from 'react';
import * as m from 'motion/react-m';
import { cn } from './cn';
import '../styles/kit.css';
import { haptic } from './haptics';
import { useSpring, useTapScale } from './motion';

export interface CardProps {
  id?: string;
  /** Occasion header card: --r-hero (= a card like its neighbour by default, blocker 11). */
  hero?: boolean;
  /** Makes the card a button (scale .98 on press). */
  onPress?: () => void;
  padding?: 'md' | 'none';
  className?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  children: ReactNode;
}

/**
 * Card (§3, wave 1): a frosted panel (.glass-panel: translucent warm white, light rim, top highlight, warm
 * shadow — no blur) over the ambient scene, --r-lg, padding 16. Solid --surface under reduced transparency.
 */
export function Card({ id, hero, onPress, padding = 'md', className, children, ...aria }: CardProps) {
  const tap = useTapScale(0.98);
  const spring = useSpring('snappy');
  const base = cn(
    'glass-panel block w-full text-left text-text',
    hero ? 'rounded-hero' : 'rounded-lg',
    padding === 'md' && 'p-4',
    className,
  );
  if (onPress) {
    return (
      <m.button
        id={id}
        type="button"
        className={cn(base, 'focus-visible:[box-shadow:var(--ring),var(--panel-shadow)]')}
        whileTap={tap}
        transition={spring}
        onPointerDown={() => haptic('tap')}
        onClick={onPress}
        {...aria}
      >
        {children}
      </m.button>
    );
  }
  return (
    <div id={id} className={base} {...aria}>
      {children}
    </div>
  );
}
