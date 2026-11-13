import type { ThemeId } from './themes'
import { CoverArt } from './CoverArt'

// The lazy half of a Start card's motif cover (feed/FeedCover.tsx FeedMotifCover shows the same box until this chunk
// is there): the occasion has no photo, but a stored motif — our own picture runs across the card's top and
// dissolves into it, exactly where a photo would (the box is .feed-cover, styles/feed.css).

export default function FeedMotif({ theme }: { theme: ThemeId }) {
  return (
    <span aria-hidden="true" className="feed-cover feed-motif" data-cover={theme}>
      <CoverArt theme={theme} className="cv-fill" />
    </span>
  )
}
