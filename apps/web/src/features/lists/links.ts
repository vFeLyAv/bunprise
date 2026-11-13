import { useMemo } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { openFollowLinkSheet } from '../people/linkSheetHost'

// Where the lists tab leads into the follows screens (follows-design §2.9, §2.10; wired by agent K2):
//   - the people screen `/people` ("N Follower · Du folgst M"; the "2 Anfragen ›" pill opens its "Anfragen"),
//   - the follow-link sheet "Freunde hinzufügen" ([Teilen] in the tab's bar, "Folgen-Link teilen" in a list's ⋯ menu, "Deinen Link
//     teilen" in the empty "Freunde") — the screen renders <FollowLinkSheetHost userId=… /> once
//     (features/people/linkSheetHost.tsx), the sheet itself is a lazy chunk.
// Every caller in features/lists goes through this hook.

export interface FollowLinks {
  /** "N Follower · Du folgst M" → /people */
  openPeople: () => void
  /** "2 Anfragen ›" → /people, its "Anfragen" section */
  openRequests: () => void
  /** the follow-link sheet (§2.9): "Link teilen" · "Link kopieren" · "gültig bis …" */
  shareFollowLink: () => void
  /** the same sheet on "Code eingeben": somebody's short code (add-friends-design §2.1) */
  enterFriendCode: () => void
}

export function useFollowLinks(): FollowLinks {
  const navigate = useNavigate()
  return useMemo(
    () => ({
      openPeople: () => {
        void navigate({ to: '/people' })
      },
      openRequests: () => {
        void navigate({ to: '/people', search: { section: 'requests' } })
      },
      shareFollowLink: () => openFollowLinkSheet(),
      enterFriendCode: () => openFollowLinkSheet({ tab: 'enter' }),
    }),
    [navigate],
  )
}
