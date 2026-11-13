import { onAccountEnded } from '../../../lib/accountBoundary'

// For whom a topic screen was opened (memory of this visit only, like session.ts — never stored, never in the URL,
// never sent): "Für mich" → "Zu meiner Wunschliste"; "Für jemanden" → "Merken für Anna" (kept on this device,
// storage.ts). Opened without it (a reload, a link): "Für mich".

export type TopicRecipient = { kind: 'me' } | { kind: 'person'; profileId: string; name: string }

let recipient: TopicRecipient | null = null

onAccountEnded(() => {
  recipient = null
})

export function rememberTopicRecipient(next: TopicRecipient): void {
  recipient = next
}

export function topicRecipient(): TopicRecipient {
  return recipient ?? { kind: 'me' }
}
