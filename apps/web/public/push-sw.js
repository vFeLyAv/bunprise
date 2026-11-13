/* Bunprise — Web Push inside the service worker (docs/spec/web-push-design.md §8).
 * Loaded by the generated sw.js with importScripts("/push-sw.js") (vite.config.ts workbox.importScripts) and checked
 * after every build by scripts/check-sw.mjs (scripts/sw-rules.mjs analyzePushWorker): only these two listeners,
 * no fetch handler, no cache, no network, no further scripts. Plain JS on purpose: it runs as it is written here.
 *   push               show the notification the Worker encrypted for this browser (title, body, tag, app path);
 *                      a payload that cannot be read still shows a neutral notification (browsers require one)
 *   notificationclick  focus an open Bunprise window and let the app go to the path; else open a new window there
 * After a sign-out the app itself drops the subscription at its next start (features/push/device.ts dropOrphanPush).
 */
'use strict'

const BUNPRISE_PUSH_FALLBACK = {
  de: { title: 'Bunprise', body: 'Es gibt etwas Neues für dich.' },
  en: { title: 'Bunprise', body: 'There is something new for you.' },
  ru: { title: 'Bunprise', body: 'Для тебя есть что-то новое.' },
  uk: { title: 'Bunprise', body: 'Для тебе є щось нове.' },
}

/** Only an app path of this origin: "/" + no second slash or backslash (never "//host" or a full URL). */
function bunprisePath(value) {
  return typeof value === 'string' && /^\/(?![/\\])[^\s]*$/.test(value) && value.length <= 200 ? value : '/soon'
}

function bunpriseText(value, max) {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

function bunpriseNotification(data) {
  const lang = data && Object.prototype.hasOwnProperty.call(BUNPRISE_PUSH_FALLBACK, data.lang) ? data.lang : 'de'
  const fallback = BUNPRISE_PUSH_FALLBACK[lang]
  const title = bunpriseText(data && data.title, 120) || fallback.title
  const body = bunpriseText(data && data.body, 300) || fallback.body
  const rawTag = data && typeof data.tag === 'string' ? data.tag : ''
  const tag = /^[a-z-]{1,40}$/.test(rawTag) ? rawTag : 'bunprise'
  return {
    title,
    options: { body, lang, tag, renotify: true, icon: '/icons/icon-192.png', data: { path: bunprisePath(data && data.url) } },
  }
}

self.addEventListener('push', (event) => {
  let data = null
  try {
    data = event.data ? event.data.json() : null
  } catch (_) {
    data = null
  }
  const { title, options } = bunpriseNotification(data)
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const path = bunprisePath(event.notification.data && event.notification.data.path)
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of windows) {
      if (new URL(client.url).origin !== self.location.origin) continue
      await client.focus()
      client.postMessage({ type: 'bunprise:open', path })
      return
    }
    await self.clients.openWindow(path)
  })())
})
