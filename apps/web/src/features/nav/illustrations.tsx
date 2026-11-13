// The two pictures of the create menu (K5): a wrapped gift ("Wunsch hinzufügen") and a party calendar page
// ("Anlass erstellen"). Own drawings, coloured from the tokens (a theme recolours them), decorative.

/** A gift with a big bow and two sparkles, on an apricot tile. */
export function GiftIllustration({ size = 64 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="cm-gift-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--accent-50)" />
          <stop offset="1" stopColor="var(--accent-200)" />
        </linearGradient>
        <linearGradient id="cm-gift-box" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--accent-300)" />
          <stop offset="1" stopColor="var(--accent-400)" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="18" fill="url(#cm-gift-bg)" />
      {/* soft floor shadow */}
      <ellipse cx="32" cy="52.5" rx="17" ry="2.6" fill="var(--accent-600)" opacity=".14" />
      {/* box and lid */}
      <rect x="15" y="29" width="34" height="22" rx="4" fill="url(#cm-gift-box)" />
      <rect x="12.5" y="22.5" width="39" height="9.5" rx="3.2" fill="var(--accent-300)" />
      <rect x="12.5" y="22.5" width="39" height="3" rx="1.5" fill="var(--surface)" opacity=".45" />
      {/* ribbon */}
      <rect x="29" y="22.5" width="6" height="28.5" fill="var(--surface)" opacity=".92" />
      <rect x="15" y="34" width="34" height="2.2" fill="var(--accent-500)" opacity=".18" />
      {/* bow */}
      <path d="M32 22.6c-2.8-6.3-10.6-8.4-11.4-4.4-.6 3 4.6 4.7 11.4 4.4z" fill="var(--tile-2-fg)" opacity=".86" />
      <path d="M32 22.6c2.8-6.3 10.6-8.4 11.4-4.4.6 3-4.6 4.7-11.4 4.4z" fill="var(--tile-2-fg)" opacity=".86" />
      <path d="M30.2 20.3h3.6a1.4 1.4 0 0 1 1.4 1.4v1.2h-6.4v-1.2a1.4 1.4 0 0 1 1.4-1.4z" fill="var(--tile-2-fg)" />
      {/* sparkles */}
      <path d="M51.5 11.5l1.2 3 3 1.2-3 1.2-1.2 3-1.2-3-3-1.2 3-1.2z" fill="var(--surface)" />
      <path d="M10.5 38.5l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8z" fill="var(--accent-500)" opacity=".7" />
    </svg>
  )
}

/** A calendar page with a heart and confetti, on a blush-to-lilac tile. */
export function PartyCalendarIllustration({ size = 64 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="cm-cal-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--tile-2)" />
          <stop offset="1" stopColor="var(--tile-3)" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="18" fill="url(#cm-cal-bg)" />
      <ellipse cx="32" cy="53" rx="16" ry="2.4" fill="var(--tile-3-fg)" opacity=".14" />
      {/* the page */}
      <rect x="14" y="16" width="36" height="35" rx="7" fill="var(--surface)" />
      <path d="M21 16h22a7 7 0 0 1 7 7v3H14v-3a7 7 0 0 1 7-7z" fill="var(--tile-2-fg)" opacity=".82" />
      <rect x="21.5" y="12" width="3.4" height="8" rx="1.7" fill="var(--text-2)" />
      <rect x="39.1" y="12" width="3.4" height="8" rx="1.7" fill="var(--text-2)" />
      {/* the heart */}
      <path d="M32 45.2s-7.6-4.4-7.6-9.6a4 4 0 0 1 7.6-1.7 4 4 0 0 1 7.6 1.7c0 5.2-7.6 9.6-7.6 9.6z" fill="var(--accent-400)" />
      <path d="M27.6 34.4a2 2 0 0 1 2.5-.9" stroke="var(--surface)" strokeWidth="1.4" strokeLinecap="round" fill="none" opacity=".8" />
      {/* confetti */}
      <rect x="51" y="9.5" width="3.2" height="6.4" rx="1.2" fill="var(--tile-4-fg)" opacity=".75" transform="rotate(28 52.6 12.7)" />
      <circle cx="9.5" cy="30" r="2" fill="var(--tile-3-fg)" opacity=".55" />
      <rect x="53" y="36" width="5.5" height="2.6" rx="1.3" fill="var(--accent-400)" opacity=".8" transform="rotate(-24 55.7 37.3)" />
      <path d="M10.4 47.5l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8z" fill="var(--surface)" />
    </svg>
  )
}
