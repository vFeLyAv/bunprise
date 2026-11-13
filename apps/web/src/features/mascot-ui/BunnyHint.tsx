import type { ReactNode } from 'react';
import { Button } from '../../ui/Button';
import { useBunniesShown, useMotionAttr } from '../../ui/motionMode';
import { Mascot } from './Mascot';

/** Inline coachmark. Its text and action always remain available without mascots or motion. */
export function BunnyHint({ text, action, onDismiss, kind = 'bunny' }: {
  text: ReactNode;
  action: string;
  onDismiss: () => void;
  kind?: 'bunny' | 'hamster';
}) {
  const shown = useBunniesShown();
  const level = useMotionAttr();
  const mascot = shown && level === 'full';
  return <div data-bunny-hint="" className={`glass-panel grid gap-x-3 gap-y-1 rounded-(--r-card) p-3 ${mascot ? 'grid-cols-[64px_minmax(0,1fr)]' : 'grid-cols-1'}`}>
    {mascot ? <div className="row-span-2 self-center" aria-hidden="true"><Mascot kind={kind} size={64} scene="greet" momentClass="illustration" /></div> : null}
    <p role="status" className="min-w-0 t-footnote text-text-2">{text}</p>
    <Button variant="ghost" className="min-h-11 justify-self-end" onClick={onDismiss}>{action}</Button>
  </div>;
}
