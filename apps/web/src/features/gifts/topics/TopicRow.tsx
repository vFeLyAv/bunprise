import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { GIFT_TOPICS, type GiftTopic, type GiftTopicCount } from '../../../lib/api/giftIdeas'
import { haptic } from '../../../ui'
import { categoryArt, CATEGORY_TONE } from '../plays/art'
import { rememberTopicRecipient, type TopicRecipient } from './topicContext'
import '../gifts.css'
import './topics.css'

// "Stöbern nach Thema" (design 26.10 §1): under the deck's buttons a row of topic tiles — our own drawing, the
// name and how many ideas. The deck stays the main way (it reads the lists); a topic is a shelf we picked to just
// browse. Only shelves with at least TOPIC_MIN ideas (an empty shelf looks worse than none). A lazy chunk of its
// own (≈ 6 KB of drawings), loaded once a deck named its shelves; nothing is fetched for it.

export const TOPIC_MIN = 8
/** The new shelf wears „Neu“ (design 26.10). */
const NEW_TOPICS: ReadonlySet<GiftTopic> = new Set(['brettspiele'])

/** The shelves to show, in our order (the answer's order never decides). */
export function shownTopics(topics: readonly GiftTopicCount[]): GiftTopicCount[] {
  return GIFT_TOPICS.flatMap((id) => {
    const found = topics.find((topic) => topic.id === id)
    return found && found.count >= TOPIC_MIN ? [found] : []
  })
}

export interface TopicRowProps {
  topics: readonly GiftTopicCount[]
  /** for whom the ideas are (the topic screen offers "Merken für Anna" / "Zu meiner Wunschliste") */
  recipient: TopicRecipient
}

export default function TopicRow({ topics, recipient }: TopicRowProps) {
  const { t } = useTranslation('gifts')
  const shown = shownTopics(topics)
  if (shown.length === 0) return null
  return (
    <section aria-labelledby="topic-row-title" className="flex flex-col">
      <h2 id="topic-row-title" className="px-1 t-headline text-text">
        {t('topics.row_title')}
      </h2>
      <ul className="topic-row" aria-labelledby="topic-row-title">
        {shown.map(({ id, count }) => (
          <li key={id}>
            <Link
              to="/gifts/topic/$topic"
              params={{ topic: id }}
              className="topic-tile"
              data-topic={id}
              onPointerDown={() => haptic('tap')}
              onClick={() => rememberTopicRecipient(recipient)}
            >
              {/* our own drawing (a static string of plays/art.ts, no data in it) */}
              <span className="topic-tile-art tile" data-tile={CATEGORY_TONE[id]} aria-hidden="true" dangerouslySetInnerHTML={{ __html: categoryArt(id) }} />
              {NEW_TOPICS.has(id) ? (
                <span className="gift-tag" data-kind="new">
                  {t('gifts.new_badge')}
                </span>
              ) : null}
              <b>{t(`topics.name.${id}`)}</b>
              <small>{id === 'brettspiele' ? t('topics.count_games', { count }) : t('topics.count_ideas', { count })}</small>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
