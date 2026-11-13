import type { ReactNode } from 'react';
import { Button, ButtonLink } from './Button';
import { cn } from './cn';
// the floating glass (.glass-bar / .glass-sheet / .glass-float / .glass-toast) ships with the kit, not globally
import '../styles/glass.css';
import { IconBack } from './icons';
import { usePageScrolled, usePageUnderBar } from './Page';

export interface TopBarBack {
  /** "Back" (from i18n). */
  label: string;
  onClick?: () => void;
  /** Plain anchor instead of onClick (rare). */
  href?: string;
}

export interface TopBarProps {
  title?: ReactNode;
  /** The page has a <LargeTitle>: show the bar title only after it scrolled away. */
  large?: boolean;
  back?: TopBarBack;
  /**
   * Right side: plain IconButtons / a ghost Button ("Fertig"). The bar puts them on ONE glass capsule
   * (iOS 26 grouped toolbar items) — pass plain controls, not glass ones.
   */
  right?: ReactNode;
  /** Left slot when there is no back button (e.g. the app logo); shown as is, without a capsule. */
  left?: ReactNode;
  className?: string;
}

/**
 * Glass top bar (§3, wave 1): fixed, --topbar-h + safe area. Its controls float as glass capsules from the
 * first frame (back = a glass pill with the chevron, the right actions share one glass capsule), so the glass
 * is visible on every screen; the centred headline fades in after the large title scrolled away.
 * Scroll edge (blocker 4): at the top of a page the bar itself has no material; once content scrolls under
 * it (Page's edge sentinel) it gets `data-scrolled` and the bar glass (.glass-bar::before: blur, saturation,
 * a light bottom edge) fades in over --dur-s.
 */
export function TopBar({ title, large, back, right, left, className }: TopBarProps) {
  const scrolled = usePageScrolled();
  const underBar = usePageUnderBar();
  const showTitle = !large || scrolled;
  return (
    <header
      data-scrolled={underBar ? '' : undefined}
      className={cn('glass-bar fixed inset-x-0 top-0 z-(--z-bar) pt-safe', className)}
    >
      {/* The side cells keep their content's width (no min-w-0): a long title truncates between them
          instead of growing over "Zurück" — it is centred while it fits, else as centred as the sides allow. */}
      <div className="mx-auto grid h-(--topbar-h) max-w-(--page-w) grid-cols-[1fr_auto_1fr] items-center px-3">
        <div className="flex items-center justify-start">
          {/* data-tg-back: inside Telegram its header's Back button presses this one (lib/telegram/bridge.ts) */}
          {back ? (
            back.href ? (
              <ButtonLink variant="glass" size="md" href={back.href} icon={<IconBack />} className="pl-2 pr-4" data-tg-back="">
                {back.label}
              </ButtonLink>
            ) : (
              <Button variant="glass" size="md" onClick={back.onClick} icon={<IconBack />} className="pl-2 pr-4" data-tg-back="">
                {back.label}
              </Button>
            )
          ) : (
            left
          )}
        </div>
        <div
          className="bar-title min-w-0 truncate px-2 text-center t-headline text-text"
          data-hidden={showTitle ? undefined : ''}
          aria-hidden={showTitle ? undefined : true}
        >
          {title}
        </div>
        <div className="flex items-center justify-end">
          {right ? <div className="glass-float flex items-center rounded-full">{right}</div> : null}
        </div>
      </div>
    </header>
  );
}
