// Web Share API with a clipboard fallback (invite sheet, product-pilot.md S7 owner view).

export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed'

export interface SharePayload {
  title?: string
  text?: string
  url?: string
}

/** True when navigator.share is available (and accepts the payload, where the browser can tell). */
export function canNativeShare(payload?: SharePayload): boolean {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return false
    if (payload && typeof navigator.canShare === 'function') return navigator.canShare(payload)
    return true
  } catch {
    return false
  }
}

/** Copies text; tries the async clipboard first, then the legacy textarea trick. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    /* clipboard API blocked or missing → fallback */
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.append(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  } catch {
    return false
  }
}

/** Native share sheet when possible, otherwise copies the URL (or text). Call from a user gesture. */
export async function share(payload: SharePayload): Promise<ShareResult> {
  if (canNativeShare(payload)) {
    try {
      await navigator.share(payload)
      return 'shared'
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled'
      /* other failures: fall through to the clipboard */
    }
  }
  const text = payload.url ?? payload.text ?? payload.title ?? ''
  return (await copyText(text)) ? 'copied' : 'failed'
}
