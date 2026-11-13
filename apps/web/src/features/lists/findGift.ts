import { useCallback } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { captureEpoch, renderedAccount } from '../../lib/accountBoundary'
import { rememberMode, rememberPerson } from '../gifts/session'

// "Geschenk finden für {{name}}" (follows-design §2.7, §00 p. 2): the Find Gift tab `/gifts` (agent H) with the
// person already chosen. SLOT: the preselection itself is wired by the integration step (Find Gift's
// "Noch frei auf {{name}}s Listen" from get_free_wishes + H's person memory); until then the button opens the
// tab. The button is shown only when the list screen says the giver may read a list of that person.

export type FindGiftFor = (profileId: string) => void

export function useFindGiftFor(): FindGiftFor {
  const navigate = useNavigate()
  return useCallback(
    (profileId: string) => {
      if (!captureEpoch().isCurrent()) return
      const myself = profileId === renderedAccount()
      rememberMode(myself ? 'for_me' : 'for_someone')
      if (!myself) rememberPerson(`profile:${profileId}`)
      void navigate({ to: '/gifts' })
    },
    [navigate],
  )
}
