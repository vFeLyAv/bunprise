// Shared-element names for the router's view transitions (design-system-motion §2.5).
// Only one element per page may carry a name at a time, or the browser skips the transition.

/** Feed card ↔ occasion hero (and its skeleton): the same name on both sides of the navigation. */
export function occasionTransitionName(occasionId: string): string {
  return `occasion-${occasionId}`
}
