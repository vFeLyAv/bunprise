// Shared by the photo route (photo.ts) and the script that picks the photos (scripts/catalog-photos.mjs), so a
// picture the script accepted is fetched by the Worker exactly the same way. No imports: the script loads it.

/** Product photos are card-sized: 2 MB is generous (the script asks Shopify CDNs for 800 px). */
export const PHOTO_MAX_BYTES = 2 * 1024 * 1024
/** Honest, like the link preview: no cookies, no referrer, no client headers ever go with it. */
export const PHOTO_USER_AGENT = 'Mozilla/5.0 (compatible; BunprisePreview/0.1)'
/** Browsers may keep a photo for a day; the Worker's own cache keeps it as long (never permanently). */
export const PHOTO_MAX_AGE_S = 86_400
/** Real product photos (photo.ts): "/api/gift-ideas/img/<art>/<id>" — <art> is the drawing to fall back to. */
export const GIFT_PHOTO_PREFIX = '/api/gift-ideas/img/'
