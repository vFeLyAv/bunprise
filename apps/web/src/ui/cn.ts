/** Joins class names, skipping falsy values. Tiny on purpose (no clsx dependency). */
export function cn(...parts: ReadonlyArray<string | false | null | undefined>): string {
  let out = '';
  for (const p of parts) {
    if (p) out = out ? `${out} ${p}` : p;
  }
  return out;
}
