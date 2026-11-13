/**
 * The kit's large full-width button look as plain class strings, for router links in modules that must
 * stay free of the Button module (it carries motion): the shell's "not found" page and the invite landing
 * `/i` (their initial chunks count toward the tightest budget, docs/contract.md §10). One module, so both
 * share the strings instead of carrying a copy each. Elsewhere use `buttonClass()` + `PressLink`.
 * = buttonClass({ variant, size: 'lg', fullWidth: true }).
 */
const CTA =
  'relative inline-flex h-13 w-full select-none items-center justify-center gap-2 whitespace-nowrap rounded-button px-5 t-headline tr-colors'

export const PRIMARY_CTA = `${CTA} bg-accent text-text-on-accent active:bg-accent-500`
export const SECONDARY_CTA = `${CTA} bg-fill text-text active:bg-fill-3`
