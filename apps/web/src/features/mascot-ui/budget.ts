import type { MomentClass } from '@bunprise/mascot';

/** Tab memory only. No account data, persistent identifiers, timers or queued moments. */
export function createMomentBudget(now: () => number = Date.now) {
  let starts: number[] = [];
  let quietUntil = 0;
  let typingUntil = 0;
  let scrollingUntil = 0;
  return {
    reset: () => { starts = []; quietUntil = 0; typingUntil = 0; scrollingUntil = 0; },
    typing: () => { typingUntil = now() + 1500; },
    scrolling: () => { scrollingUntil = now() + 600; },
    end: () => { quietUntil = now() + 8000; },
    claim(kind: MomentClass): boolean {
      // next-ux-plan §9.1/11 keeps user responses frequent; the general response cap is deferred.
      if (kind === 'work' || kind === 'response') return true;
      const t = now();
      if (t < typingUntil || t < scrollingUntil) return false;
      if (kind === 'illustration') return true;
      starts = starts.filter((started) => t - started < 60_000);
      if (t < quietUntil || starts.length >= 3) return false;
      starts.push(t);
      return true;
    },
  };
}

export const momentBudget = createMomentBudget();
let listeners = 0;
const typing = () => momentBudget.typing();
const scrolling = () => momentBudget.scrolling();
const keydown = (event: KeyboardEvent) => {
  const target = event.target;
  if (target instanceof HTMLElement && (target.matches('input,textarea,[contenteditable="true"]') || target.isContentEditable)) typing();
};

/** Install only while a lazy mascot wrapper is mounted. */
export function observeMomentActivity(): () => void {
  if (listeners++ === 0) {
    document.addEventListener('input', typing, true);
    document.addEventListener('keydown', keydown, true);
    document.addEventListener('scroll', scrolling, true);
    document.addEventListener('touchmove', scrolling, { passive: true, capture: true });
  }
  return () => {
    if (--listeners !== 0) return;
    document.removeEventListener('input', typing, true);
    document.removeEventListener('keydown', keydown, true);
    document.removeEventListener('scroll', scrolling, true);
    document.removeEventListener('touchmove', scrolling, true);
  };
}
