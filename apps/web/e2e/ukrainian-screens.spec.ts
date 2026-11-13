import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

// Bunprise in Ukrainian (2026-10-27) in the demo, Firefox at phone size (390 × 844, 2× pixels) with a Ukrainian browser
// (locale uk-UA: the app's own detector picks Ukrainian, nothing is switched by hand). Login, Start (list + month),
// Списки (Мої / Друзі), a list with wish tiles, a wish sheet, the "+" menu, Ідеї, Профіль with the language
// switcher, a legal page (German text + Ukrainian note), an occasion with the RSVP control — and the same at 320 px.
// Every screen also reports Ukrainian text that is cut or sticks out of its box (console).
// Screens go to docs/screens/2026-10-27-ukrainian/ (or SCREENS_OUT). The demo resets on reload: everything below
// navigates inside the app after seeding through the app's own API modules (as russian-screens.spec.ts does).

const OUT = process.env.SCREENS_OUT ? resolve(process.env.SCREENS_OUT) : resolve(process.cwd(), '../../docs/screens/2026-10-27-ukrainian')
mkdirSync(OUT, { recursive: true })

test.use({ deviceScaleFactor: 2, locale: 'uk-UA' })

// Headless Firefox does not paint backdrop-filter: the app's own solid material, as in the other screen specs.
async function solidMaterials(page: Page) {
  await page.addInitScript(() => {
    const set = () => document.documentElement.setAttribute('data-transparency', 'reduce')
    if (document.documentElement) set()
    document.addEventListener('DOMContentLoaded', set)
  })
}

async function settle(page: Page) {
  await page.evaluate(async () => {
    const finite = document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
    await Promise.all(finite.map((animation) => animation.finished.catch(() => undefined)))
  })
  await page.waitForTimeout(500)
}

async function shot(page: Page, name: string) {
  await settle(page)
  await page.screenshot({ path: `${OUT}/${name}.png` })
}

/** Elements whose Ukrainian text is cut or sticks out of its box (scrollWidth > clientWidth on a nowrap / clipped element). */
async function overflowing(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const found: string[] = []
    for (const element of Array.from(document.querySelectorAll<HTMLElement>('button, a, [role="radio"], [role="tab"], span, h1, h2, h3, p, label'))) {
      // sr-only copies (1 px boxes) are not shown
      if (!element.offsetParent || element.children.length > 2 || element.clientWidth <= 1) continue
      const text = element.textContent?.trim() ?? ''
      if (!/[а-щьюяєіїґ]/i.test(text)) continue
      const style = getComputedStyle(element)
      const clips = style.overflow !== 'visible' || style.textOverflow === 'ellipsis' || style.whiteSpace === 'nowrap'
      if (clips && element.scrollWidth > element.clientWidth + 1) found.push(`${element.tagName.toLowerCase()} "${text.slice(0, 60)}" ${element.scrollWidth}>${element.clientWidth}`)
    }
    return found
  })
}

async function report(page: Page, where: string, log: string[]) {
  const found = await overflowing(page)
  if (found.length) log.push(`${where}: ${found.join(' | ')}`)
}

async function signUp(page: Page) {
  await page.goto('/login?mode=signup&method=email&frame=0')
  await expect(page.locator('html')).toHaveAttribute('lang', 'uk')
  await shot(page, 'b-login-signup-390')
  await page.getByLabel('Ел. пошта', { exact: true }).fill('olia@example.test')
  await page.getByRole('checkbox').nth(0).check()
  await page.getByRole('checkbox').nth(1).check()
  await shot(page, 'b-login-signup-checked-390')
  await page.getByRole('button', { name: 'Надіслати код', exact: true }).click()
  await expect(page.getByLabel('Шестизначний код', { exact: true })).toBeVisible()
  await shot(page, 'c-code-390')
  await page.getByLabel('Шестизначний код', { exact: true }).fill('123456')
  await expect(page.getByLabel('Ім’я', { exact: true })).toBeVisible()
  await shot(page, 'd-profile-name-390')
  await page.getByLabel('Ім’я', { exact: true }).fill('Оля')
  await page.getByRole('button', { name: 'Готово', exact: true }).click()
  await page.getByRole('button', { name: 'Пропустити', exact: true }).click()
}

/** Two own lists (one with a cover), wishes with and without photo, and an own occasion in a few days. */
async function seed(page: Page) {
  return page.evaluate(async () => {
    const lists = (await import(/* @vite-ignore */ '/src/lib/api/lists.ts')) as {
      newListId: () => string
      createList: (input: object) => Promise<{ id: string }>
    }
    const wishes = (await import(/* @vite-ignore */ '/src/lib/api/wishes.ts')) as {
      createWish: (listId: string, input: object) => Promise<{ id: string }>
    }
    const wishPhotos = (await import(/* @vite-ignore */ '/src/lib/api/wishPhotos.ts')) as {
      uploadWishPhoto: (wishId: string, photo: object) => Promise<unknown>
    }
    const listPhotos = (await import(/* @vite-ignore */ '/src/lib/api/listPhotos.ts')) as {
      uploadListPhoto: (listId: string, photo: object) => Promise<unknown>
    }
    const occasions = (await import(/* @vite-ignore */ '/src/lib/api/occasions.ts')) as {
      createOccasion: (input: object) => Promise<{ occasionId: string }>
    }
    async function photo(path: string) {
      const blob = await (await fetch(path)).blob()
      const bitmap = await createImageBitmap(blob)
      return { mime: 'image/webp', bytes: new Uint8Array(await blob.arrayBuffer()), width: bitmap.width, height: bitmap.height }
    }
    const product = await photo('/src/mocks/assets/demo-product.webp')
    const cover = await photo('/src/mocks/assets/demo-list-christmas.webp')

    const birthday = lists.newListId()
    await lists.createList({ id: birthday, title: 'Мій день народження', visibility: 'followers', cover_tone: 3, cover_icon: 'cake', due_on: null })
    await listPhotos.uploadListPhoto(birthday, cover)
    const books = lists.newListId()
    await lists.createList({ id: books, title: 'Книжки', visibility: 'private', cover_tone: 1, cover_icon: 'book', due_on: null })

    const add = async (listId: string, input: object, withPhoto: boolean) => {
      const wish = await wishes.createWish(listId, input)
      if (withPhoto) await wishPhotos.uploadWishPhoto(wish.id, product)
    }
    await add(birthday, { title: 'Кавомолка з керамічними жорнами', price_cents: 8990, url: 'https://www.amazon.de/dp/B000TEST01', priority: 3, brand: 'Kegel', color: 'Горіх', description: 'Ручна кавомолка з горіхового дерева. Помел налаштовується від дрібного (еспресо) до грубого (френч-прес).' }, true)
    await add(birthday, { title: 'Сертифікат у кіно', price_cents: 2500, url: null, priority: 2 }, false)
    await add(birthday, { title: 'Туристичний рюкзак 30 л', price_cents: 12900, url: 'https://www.zalando.de/rucksack-test', priority: 2 }, true)
    await add(birthday, { title: 'Рослина для балкона', price_cents: null, url: 'https://www.ikea.com/de/de/p/test', priority: 1 }, false)
    await add(books, { title: 'Гобіт', price_cents: 1400, url: null, priority: 2 }, false)

    const inFiveDays = new Date(Date.now() + 5 * 86_400_000)
    inFiveDays.setUTCHours(16, 0, 0, 0)
    await occasions.createOccasion({ title: 'День народження Олі', starts_at: inFiveDays.toISOString(), tz: 'Europe/Berlin', all_day: false, place_text: 'Кафе біля ринку' })
    // Start was already open: let the app's own cache fetch the new world
    const query = (await import(/* @vite-ignore */ '/src/lib/query.ts')) as { queryClient: { invalidateQueries: () => Promise<void> } }
    await query.queryClient.invalidateQueries()
    return { birthday, books }
  })
}

/**
 * A fresh demo account with Ukrainian seed data on Start. Each test below signs up anew: the demo lives in the page's
 * memory, and a dev-server reload (other files changing while the spec runs) would otherwise wipe all later screens.
 */
async function begin(page: Page, width = 390) {
  const errors: string[] = []
  const cut: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await solidMaterials(page)
  await signUp(page)
  await seed(page)
  if (width !== 390) await page.setViewportSize({ width, height: 700 })
  const nav = page.getByRole('navigation', { name: 'Головне меню' })
  await nav.getByRole('link', { name: /^Головна/ }).click()
  await expect(page.getByText('День народження Олі').first()).toBeVisible()
  return { nav, cut, errors }
}

function finish(where: string, cut: string[], errors: string[]) {
  console.log(`[${where}] cut or overflowing Ukrainian text:`, cut.length ? `\n  ${cut.join('\n  ')}` : 'none')
  console.log(`[${where}] page errors:`, errors.length ? errors.join(' | ') : 'none')
}

test('Bunprise in Ukrainian: landing, sign-up, Start, month and two occasions at 390 px', async ({ page }) => {
  test.setTimeout(180_000)
  await solidMaterials(page)
  await page.goto('/?frame=0')
  await expect(page.locator('html')).toHaveAttribute('lang', 'uk')
  await shot(page, 'a-start-landing-390')
  const { cut, errors } = await begin(page)
  await shot(page, 'e-start-list-390')
  await report(page, 'start list', cut)
  await page.getByRole('radio', { name: 'Місяць', exact: true }).click()
  await shot(page, 'f-start-month-390')
  await report(page, 'start month', cut)
  await page.mouse.wheel(0, 500)
  await shot(page, 'f-start-month-agenda-390')
  await page.getByRole('radio', { name: 'Список', exact: true }).click()
  await settle(page)

  // an occasion of the demo world as a guest: the RSVP control "Так / Можливо / Ні"
  await page.getByRole('link', { name: /Annas Einweihung/ }).first().click()
  await expect(page.getByRole('radiogroup', { name: 'Твоя відповідь' })).toBeAttached({ timeout: 15_000 })
  await shot(page, 'g-occasion-guest-390')
  await report(page, 'occasion', cut)
  await page.getByRole('radiogroup', { name: 'Твоя відповідь' }).scrollIntoViewIfNeeded()
  await shot(page, 'g-occasion-guest-rsvp-390')
  await report(page, 'occasion rsvp', cut)
  await page.mouse.wheel(0, 700)
  await shot(page, 'g-occasion-guest-wishes-390')
  await report(page, 'occasion wishes', cut)
  await page.goBack()
  await settle(page)

  // the own occasion (host view)
  await page.getByRole('link', { name: /День народження Олі/ }).first().click()
  await expect(page.getByRole('heading', { name: /День народження Олі/ }).first()).toBeVisible({ timeout: 15_000 })
  await shot(page, 'g-occasion-host-390')
  await report(page, 'occasion host', cut)
  await page.mouse.wheel(0, 700)
  await shot(page, 'g-occasion-host-scrolled-390')
  await report(page, 'occasion host scrolled', cut)
  await page.goBack()
  await settle(page)

  finish('390 start', cut, errors)
})

test('Bunprise in Ukrainian: Списки, a list, the wish menu and a wish sheet at 390 px', async ({ page }) => {
  test.setTimeout(180_000)
  const { nav, cut, errors } = await begin(page)
  await nav.getByRole('link', { name: /^Списки/ }).click()
  await expect(page.getByRole('link', { name: /Мій день народження/ })).toBeVisible()
  await shot(page, 'h-lists-mine-390')
  await report(page, 'lists mine', cut)
  await page.getByRole('radio', { name: 'Друзі', exact: true }).click()
  await shot(page, 'i-lists-friends-390')
  await report(page, 'lists friends', cut)
  await page.mouse.wheel(0, 600)
  await shot(page, 'i-lists-friends-scrolled-390')
  await report(page, 'lists friends scrolled', cut)
  await page.getByRole('radio', { name: 'Мої', exact: true }).click()
  await settle(page)

  await page.getByRole('link', { name: /Мій день народження/ }).click()
  await expect(page.getByRole('button', { name: /Кавомолка/ }).first()).toBeVisible({ timeout: 15_000 })
  await shot(page, 'j-list-hero-390')
  await report(page, 'list hero', cut)
  await page.mouse.wheel(0, 400)
  await shot(page, 'j-list-wish-tiles-390')
  await report(page, 'list', cut)

  await page.getByRole('button', { name: 'Ще: «Сертифікат у кіно»' }).click()
  await shot(page, 'k-wish-menu-390')
  await report(page, 'wish menu', cut)
  await page.keyboard.press('Escape')
  await settle(page)
  await page.getByRole('button', { name: 'Ще: «Сертифікат у кіно»' }).click()
  await page.getByRole('button', { name: 'Наскільки хочеться?' }).click()
  await shot(page, 'k-priority-390')
  await report(page, 'priority', cut)
  await page.keyboard.press('Escape')
  await settle(page)

  await page.getByRole('button', { name: /Кавомолка/ }).first().click()
  await shot(page, 'l-wish-sheet-390')
  await report(page, 'wish sheet', cut)
  await page.keyboard.press('Escape')
  await settle(page)
  await page.goBack()
  await settle(page)

  finish('390 lists', cut, errors)
})

test('Bunprise in Ukrainian: the "+" menu, Ідеї and Профіль with the language choice at 390 px', async ({ page }) => {
  test.setTimeout(180_000)
  const { nav, cut, errors } = await begin(page)
  await nav.getByRole('button', { name: 'Створити' }).click()
  await shot(page, 'm-plus-menu-390')
  await report(page, 'plus menu', cut)
  await page.keyboard.press('Escape')
  await settle(page)

  await nav.getByRole('link', { name: /^Ідеї/ }).click()
  await expect(page.getByRole('region', { name: 'Ідеї подарунків' }).getByRole('article').first()).toBeVisible({ timeout: 30_000 })
  await shot(page, 'n-ideas-390')
  await report(page, 'ideas', cut)
  await page.getByRole('radio', { name: 'Для себе', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Ідеї подарунків' }).getByRole('article').first()).toBeVisible({ timeout: 30_000 })
  await shot(page, 'n-ideas-me-390')
  await report(page, 'ideas me', cut)

  await nav.getByRole('link', { name: /^Профіль/ }).click()
  // since 27.10 the language is one row (the current language by its own name); the list opens as a sheet
  const languageRow = page.getByRole('button', { name: /^Мова/ })
  await expect(languageRow).toBeAttached({ timeout: 15_000 })
  await shot(page, 'o-profile-390')
  await report(page, 'profile', cut)
  await languageRow.scrollIntoViewIfNeeded()
  await expect(languageRow.locator('[data-language-name]')).toHaveText('Українська')
  await shot(page, 'o-profile-language-390')
  await report(page, 'profile language', cut)
  await page.mouse.wheel(0, 1600)
  await shot(page, 'o-profile-bottom-390')
  await report(page, 'profile bottom', cut)

  finish('390 ideas profile', cut, errors)
})

test('Bunprise in Ukrainian: Профіль, Start, month and an occasion at 320 px', async ({ page }) => {
  test.setTimeout(180_000)
  const { nav, cut, errors } = await begin(page, 320)
  await nav.getByRole('link', { name: /^Профіль/ }).click()
  await expect(page.getByRole('radiogroup', { name: 'Мова' })).toBeAttached({ timeout: 15_000 })
  await page.getByRole('radiogroup', { name: 'Мова' }).scrollIntoViewIfNeeded()
  await shot(page, 'p-profile-language-320')
  await report(page, 'profile 320', cut)
  await nav.getByRole('link', { name: /^Головна/ }).click()
  await shot(page, 'q-start-list-320')
  await report(page, 'start 320', cut)
  await page.getByRole('radio', { name: 'Місяць', exact: true }).click()
  await shot(page, 'q-start-month-320')
  await report(page, 'month 320', cut)
  await page.getByRole('radio', { name: 'Список', exact: true }).click()
  await settle(page)
  await page.getByRole('link', { name: /Annas Einweihung/ }).first().click()
  await expect(page.getByRole('radiogroup', { name: 'Твоя відповідь' })).toBeAttached({ timeout: 15_000 })
  await page.getByRole('radiogroup', { name: 'Твоя відповідь' }).scrollIntoViewIfNeeded()
  await shot(page, 'r-occasion-guest-rsvp-320')
  await report(page, 'occasion 320', cut)
  await page.goBack()
  await settle(page)

  finish('320 start', cut, errors)
})

test('Bunprise in Ukrainian: Списки, a wish sheet, the "+" menu, Ідеї and a legal page at 320 px', async ({ page }) => {
  test.setTimeout(180_000)
  const { nav, cut, errors } = await begin(page, 320)
  await nav.getByRole('link', { name: /^Списки/ }).click()
  await shot(page, 's-lists-mine-320')
  await report(page, 'lists 320', cut)
  await page.getByRole('radio', { name: 'Друзі', exact: true }).click()
  await shot(page, 's-lists-friends-320')
  await report(page, 'friends 320', cut)
  await page.getByRole('radio', { name: 'Мої', exact: true }).click()
  await settle(page)
  await page.getByRole('link', { name: /Мій день народження/ }).click()
  await expect(page.getByRole('button', { name: /Кавомолка/ }).first()).toBeVisible({ timeout: 15_000 })
  await page.mouse.wheel(0, 400)
  await shot(page, 't-list-wish-tiles-320')
  await report(page, 'list 320', cut)
  await page.getByRole('button', { name: /Кавомолка/ }).first().click()
  await shot(page, 't-wish-sheet-320')
  await report(page, 'wish sheet 320', cut)
  await page.keyboard.press('Escape')
  await settle(page)
  await page.goBack()
  await settle(page)
  await nav.getByRole('button', { name: 'Створити' }).click()
  await shot(page, 'u-plus-menu-320')
  await report(page, 'plus menu 320', cut)
  await page.keyboard.press('Escape')
  await settle(page)
  await nav.getByRole('link', { name: /^Ідеї/ }).click()
  await expect(page.getByRole('region', { name: 'Ідеї подарунків' }).getByRole('article').first()).toBeVisible({ timeout: 30_000 })
  await shot(page, 'v-ideas-320')
  await report(page, 'ideas 320', cut)

  // a legal page from the profile: the German text with the Ukrainian note on top
  await nav.getByRole('link', { name: /^Профіль/ }).click()
  await page.getByRole('link', { name: /Умови використання/ }).click()
  await expect(page.getByText('Юридичні тексти є лише німецькою та англійською мовами. Нижче — німецька версія.')).toBeVisible({ timeout: 15_000 })
  await shot(page, 'w-legal-terms-320')

  finish('320 lists', cut, errors)
})

test('Bunprise in Ukrainian: before sign-in at 320 px', async ({ page }) => {
  const cut: string[] = []
  await solidMaterials(page)
  await page.setViewportSize({ width: 320, height: 700 })
  await page.goto('/?frame=0')
  await expect(page.locator('html')).toHaveAttribute('lang', 'uk')
  await shot(page, 'x-start-landing-320')
  await report(page, 'landing 320', cut)
  await page.goto('/login?mode=signup&method=email&frame=0')
  await expect(page.getByLabel('Ел. пошта', { exact: true })).toBeVisible()
  await shot(page, 'y-login-signup-320')
  await report(page, 'login 320', cut)
  await page.goto('/login?frame=0')
  await expect(page.getByRole('link', { name: /Google/ })).toBeVisible()
  await shot(page, 'y-login-methods-320')
  await report(page, 'login methods 320', cut)
  console.log('cut or overflowing Ukrainian text (320, signed out):', cut.length ? `\n  ${cut.join('\n  ')}` : 'none')
})
