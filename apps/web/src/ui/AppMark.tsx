import { cn } from './cn';

/**
 * The app icon (public/icons/icon.svg: the bunny peeking over the edge), the same file as the favicon. Decorative.
 * Painted with its header (decoding="sync"): a screen that comes back (the Start tab) never shows an empty square.
 */
export function AppMark({ size = 28, className }: { size?: 28 | 36; className?: string }) {
  return (
    <img
      src="/icons/icon.svg"
      alt=""
      width={size}
      height={size}
      decoding="sync"
      className={cn('shrink-0 elev-1', size === 36 ? 'h-9 w-9 rounded-sm' : 'h-7 w-7 rounded-xs', className)}
    />
  );
}

/**
 * The brand mark (blocker 14): the app icon + the app name in --text — one sign everywhere (feed header,
 * start screen), never a small accent word that reads like a link. `name` from i18n / APP_NAME.
 */
export function BrandMark({ name, size = 28, className }: { name: string; size?: 28 | 36; className?: string }) {
  return (
    <span className={cn('flex min-w-0 items-center gap-2', className)}>
      <AppMark size={size} />
      <span className="truncate t-headline text-text">{name}</span>
    </span>
  );
}

/**
 * The quiet brand stamp at the very bottom of a sheet (Felix 22.10: a screenshot of a wish shows where it is
 * from): the app icon, 20 px with app-icon corners, and the name in the secondary text colour, centred. Put it
 * into a sheet's pinned footer, under the actions, so it is in view however the content scrolls.
 * Decorative: aria-hidden — the screen reader hears nothing of it. The icon is the favicon file (precached by
 * the service worker), so the stamp costs no bytes in any JS chunk. `name` from i18n (common.app_name).
 */
export function BrandStamp({ name, className }: { name: string; className?: string }) {
  return (
    <div aria-hidden="true" data-brand-stamp="" className={cn('flex select-none items-center justify-center gap-1.5', className)}>
      <img src="/icons/icon.svg" alt="" width={20} height={20} decoding="async" draggable={false} className="h-5 w-5 shrink-0 rounded-[5px]" />
      <span className="t-footnote font-semibold tracking-[-0.01em] text-text-2">{name}</span>
    </div>
  );
}
