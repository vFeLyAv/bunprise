import { useCallback } from 'react'
import { captureEpoch } from '../../lib/accountBoundary'
import { createMenu } from '../nav/createMenuStore'

/** No request until the person taps. The menu owns target selection and the explicit private-list step. */
export function useStartFirstWish(userId: string): () => void {
  return useCallback(() => {
    const epoch = captureEpoch()
    if (!epoch.isCurrent() || (epoch.userId !== undefined && epoch.userId !== userId)) return
    createMenu.open('wish')
  }, [userId])
}
