// What a push notification SAYS (docs/spec/web-push-design.md §0, Р1). The database sends structured fields (kind,
// inviter's display name, occasion title, language of the subscription); the words live here, in the four app
// languages, like the card on Start (apps/web/src/locales/<lng>/invitations.json "card.title" / "card.when").
// PUSH_TEXT=neutral (wrangler.jsonc) switches to a text without names or titles.
// Never anything about reservations, wishes or lists — there is no such kind (design §6, §11).

export const PUSH_LANGS = ['de', 'en', 'ru', 'uk'] as const
export type PushLang = (typeof PUSH_LANGS)[number]

export interface InvitationFields {
  inviter: string
  title: string
}

export interface Notification {
  title: string
  body: string
  /** where a tap leads: Start, where the invitation card is (an app path, never a full URL) */
  url: string
  /** a newer invitation replaces the older one on the lock screen (the app shows all of them) */
  tag: string
  lang: PushLang
}

interface Words {
  someone: string
  title: (name: string) => string
  body: (title: string) => string
  neutralTitle: string
  neutralBody: string
}

const WORDS: Record<PushLang, Words> = {
  de: {
    someone: 'Jemand',
    title: (name) => `${name} lädt dich ein`,
    body: (title) => `„${title}“ · Tippe, um zu antworten.`,
    neutralTitle: 'Neue Einladung',
    neutralBody: 'Öffne Bunprise, um sie zu sehen.',
  },
  en: {
    someone: 'Someone',
    title: (name) => `${name} invites you`,
    body: (title) => `“${title}” · Tap to reply.`,
    neutralTitle: 'New invitation',
    neutralBody: 'Open Bunprise to see it.',
  },
  ru: {
    someone: 'Кто-то',
    title: (name) => `${name} приглашает тебя`,
    body: (title) => `«${title}» · Нажми, чтобы ответить.`,
    neutralTitle: 'Новое приглашение',
    neutralBody: 'Открой Bunprise, чтобы посмотреть.',
  },
  uk: {
    someone: 'Хтось',
    title: (name) => `${name} запрошує тебе`,
    body: (title) => `«${title}» · Торкнися, щоб відповісти.`,
    neutralTitle: 'Нове запрошення',
    neutralBody: 'Відкрий Bunprise, щоб переглянути.',
  },
}

/** One line, no control or bidi-override characters, at most `max` characters (an ellipsis when cut). */
export function cleanText(value: string, max: number): string {
  const flat = value.replace(/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim()
  const chars = Array.from(flat)
  return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : flat
}

export function invitationNotification(fields: InvitationFields, lang: PushLang, neutral: boolean): Notification {
  const words = WORDS[lang]
  if (neutral) return { title: words.neutralTitle, body: words.neutralBody, url: '/soon', tag: 'invitation', lang }
  const name = cleanText(fields.inviter, 40) || words.someone
  const title = cleanText(fields.title, 80)
  return { title: words.title(name), body: title ? words.body(title) : words.neutralBody, url: '/soon', tag: 'invitation', lang }
}
