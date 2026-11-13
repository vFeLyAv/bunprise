// The home-screen icons to choose from (Felix 27.10, Profil → Einstellungen → App-Symbol; docs/handoffs/2026-10-27-app-icons.md).
// Pure data and paths, no DOM: vite.config.ts imports this file too (one web manifest per variant at build time).
//
// 'classic' is the app's own icon (public/icons/*, public/apple-touch-icon.png, the default manifest.webmanifest) —
// nothing changes for anyone who never chooses. Every other variant lives in public/icons/variants/<id>/ (drawn by
// scripts/app-icons.mjs) with its manifest next to it (built by vite.config.ts). None of them is precached by the
// service worker: a device fetches only the one it chose (vite.config.ts globIgnores, scripts/check-sw.mjs).
// The same list is spelled out in public/boot.js (the regex that guards the stored choice): change both.

/** In the picker's order: the classic one, the everyday ones, then the occasions through the year. */
export const APP_ICONS = ['classic', 'dark', 'night', 'ocean', 'mono', 'tapsi', 'birthday', 'easter', 'summer', 'autumn', 'halloween', 'christmas'] as const
export type AppIconId = (typeof APP_ICONS)[number]
export const DEFAULT_APP_ICON: AppIconId = 'classic'

/** The variants with files of their own (everything but the default). */
export const APP_ICON_VARIANTS: readonly Exclude<AppIconId, 'classic'>[] = APP_ICONS.filter((id): id is Exclude<AppIconId, 'classic'> => id !== 'classic')

export function isAppIcon(value: unknown): value is AppIconId {
  return typeof value === 'string' && (APP_ICONS as readonly string[]).includes(value)
}

/** The files the page links to for one choice (absolute paths of this origin). */
export interface AppIconLinks {
  /** <link rel="manifest"> — Android / Chrome read the icons from here when the app is installed */
  manifest: string
  /** <link rel="apple-touch-icon"> — iOS takes this picture at "Zum Home-Bildschirm" */
  appleTouchIcon: string
  /** <link rel="icon"> — the browser tab; also the picker's preview (a vector, small once compressed) */
  icon: string
}

export function appIconLinks(id: AppIconId): AppIconLinks {
  if (id === 'classic') return { manifest: '/manifest.webmanifest', appleTouchIcon: '/apple-touch-icon.png', icon: '/icons/icon.svg' }
  const dir = `/icons/variants/${id}/`
  return { manifest: `${dir}manifest.webmanifest`, appleTouchIcon: `${dir}apple-touch-icon.png`, icon: `${dir}icon.svg` }
}

export interface ManifestIcon {
  src: string
  sizes: string
  type: 'image/png'
  purpose: 'any' | 'maskable'
}

/** The `icons` of a variant's manifest: the same four sizes and purposes as the default manifest. */
export function appIconManifestIcons(id: Exclude<AppIconId, 'classic'>): ManifestIcon[] {
  const dir = `/icons/variants/${id}/`
  return [
    { src: `${dir}icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: `${dir}icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: `${dir}icon-192-maskable.png`, sizes: '192x192', type: 'image/png', purpose: 'maskable' },
    { src: `${dir}icon-512-maskable.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ]
}

/**
 * A variant's manifest: the default one (as vite-plugin-pwa wrote it) word for word, only the icons differ — the same
 * id, start_url and scope, so an installed Bunprise stays the same app whichever icon it carries.
 */
export function variantManifest(base: Record<string, unknown>, id: Exclude<AppIconId, 'classic'>): Record<string, unknown> {
  return { ...base, icons: appIconManifestIcons(id) }
}
