import type { QueryClient } from '@tanstack/react-query'

/** Context every route receives (createRootRouteWithContext / createRouter in src/router.tsx). */
export interface RouterContext {
  queryClient: QueryClient
}
