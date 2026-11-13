import { useEffect, useRef, type CSSProperties, type RefObject } from 'react';
import type { BunnyCoat, HamsterCoat, MomentClass } from '@bunprise/mascot';
import { useMascotMotion } from './mascotMotion';
import { loadMascotModule } from './Mascot';
import { momentBudget, observeMomentActivity } from './budget';
import { registerMascot, releaseStage, requestStage, unregisterMascot } from './stage';
import { playsInApp } from './inGallery';

export interface MoveMomentProps {
  kind: 'chase' | 'nibble' | 'overfed' | 'hamster';
  /** «Переел» only: which of the approved variants (a «Хватит», b «Последний кусочек», c «Ик!»). */
  variant?: 'a' | 'b' | 'c';
  coat?: BunnyCoat;
  hamsterCoat?: HamsterCoat;
  edge?: 'bottom' | 'left' | 'right';
  targetRef?: RefObject<HTMLElement | null>;
  cheeks?: number;
  loop?: boolean;
  stay?: boolean;
  illustration?: boolean;
  momentClass?: MomentClass;
  onEnd?: () => void;
  onStart?: () => void;
  className?: string;
  style?: CSSProperties;
}

/** Load with React.lazy. All stage constructors stay behind the existing mascot import(). */
export default function MoveMoment(props: MoveMomentProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const { shown, reducedMotion } = useMascotMotion();
  const options = useRef(props);
  const onEnd = useRef(props.onEnd);
  useEffect(() => { onEnd.current = props.onEnd; });
  useEffect(observeMomentActivity, []);
  useEffect(() => {
    const host = hostRef.current;
    const o = options.current;
    // a scene still in the gallery never plays in the app (inGallery.ts; the callers show their alternative)
    if (!shown || !host || !playsInApp(o.kind, o.variant)) return;
    const role = o.momentClass ?? (o.illustration ? 'illustration' : 'decoration');
    let stage: InstanceType<Awaited<ReturnType<typeof loadMascotModule>>['ChaseStage']> | InstanceType<Awaited<ReturnType<typeof loadMascotModule>>['NibbleStage']> | InstanceType<Awaited<ReturnType<typeof loadMascotModule>>['OverfedStage']> | InstanceType<Awaited<ReturnType<typeof loadMascotModule>>['HamsterEdgeStage']> | null = null;
    const id = Symbol('move');
    let cancelled = false;
    const frame = requestAnimationFrame(() => {
      void loadMascotModule().then((mod) => {
        if (cancelled) return;
        const allowed = reducedMotion !== 'force' && momentBudget.claim(role);
        if (!allowed && !o.illustration) return;
        const common = { reducedMotion: allowed ? reducedMotion : 'force' as const, onEnd: () => { momentBudget.end(); releaseStage(id); onEnd.current?.(); } };
        if (o.kind === 'chase') stage = new mod.ChaseStage(host, { ...common, ...(o.coat ? { coat: o.coat } : {}), ...(o.loop ? { loop: true } : {}), ...(o.edge && o.edge !== 'bottom' ? { from: o.edge } : {}) });
        else if (o.kind === 'nibble') {
          if (!o.targetRef?.current) return;
          stage = new mod.NibbleStage(host, { ...common, target: o.targetRef.current, ...(o.coat ? { coat: o.coat } : {}), ...(o.edge && o.edge !== 'bottom' ? { corner: o.edge } : {}) });
        } else if (o.kind === 'overfed') stage = new mod.OverfedStage(host, { ...common, ...(o.coat ? { coat: o.coat } : {}), ...(o.variant ? { variant: o.variant } : {}), illustration: o.illustration ?? false });
        else stage = new mod.HamsterEdgeStage(host, { ...common, ...(o.hamsterCoat ? { coat: o.hamsterCoat } : {}), ...(o.edge ? { edge: o.edge } : {}), ...(o.cheeks !== undefined ? { cheeks: o.cheeks } : {}), stay: o.stay ?? true, illustration: o.illustration ?? false });
        const created = stage;
        registerMascot(id, { get busy() { return created.busy; }, get isDestroyed() { return created.isDestroyed; }, get suspended() { return created.suspended; }, stopIdle: () => created.pause(), startIdle: () => undefined, interrupt: () => created.stop(false) }, false);
        // a played chase / «Переел» (also its calm version) is a find of «Pompons Sammlung» (features/sammlung/note.ts)
        const played = () => { const v = 'variant' in created ? created.variant : ''; void import('../sammlung/note').then((m) => m.noteMoveScene(o.kind, v), () => undefined); };
        if (allowed && requestStage(id, role)) { o.onStart?.(); created.play(); played(); }
        else if (o.illustration) { created.setReducedMotion('force'); created.play(); played(); }
        else created.stop(false);
      }).catch(() => undefined);
    });
    return () => { cancelled = true; cancelAnimationFrame(frame); unregisterMascot(id); stage?.destroy(); };
  }, [shown, reducedMotion]);
  if (!shown || !playsInApp(props.kind, props.variant) || (reducedMotion === 'force' && !props.illustration)) return null;
  return <div ref={hostRef} data-move={props.kind} aria-hidden="true" className={props.className} style={{ pointerEvents: 'none', ...props.style }} />;
}
