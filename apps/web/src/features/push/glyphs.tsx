// The bell of Web Push (Profil row, the hint under an invitation card, the sheet). Decorative: aria-hidden.
export function GlyphBell({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 9.5a6 6 0 0 1 12 0c0 4.6 1.6 6.3 2.4 7H3.6c.8-.7 2.4-2.4 2.4-7Z" />
      <path d="M10 19.5a2.2 2.2 0 0 0 4 0" />
    </svg>
  )
}
