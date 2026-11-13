import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

// Bunprise in Russian (2026-10-23) in the demo, Firefox at phone size (390 × 844, 2× pixels) with a Russian browser
// (locale ru-RU: the app's own detector picks Russian, nothing is switched by hand). Login, Start (list + month),
// Списки (Мои / Друзья), a list with wish tiles, a wish sheet, the "+" menu, Идеи, Профиль with the language
// switcher, a legal page (German text + Russian note), an occasion with the RSVP control — and the same at 320 px.
// Screens go to docs/screens/2026-10-23-russian/. The demo resets on reload: everything below navigates inside the
// app after seeding through the app's own API modules (as lists-wave2-screens.spec.ts does).

const OUT = resolve(process.cwd(), '../../docs/screens/2026-10-23-russian')
mkdirSync(OUT, { recursive: true })

test.use({ deviceScaleFactor: 2, locale: 'ru-RU' })

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

/** Elements whose text is cut or sticks out of its box (scrollWidth > clientWidth on a nowrap / clipped element). */
async function overflowing(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const found: string[] = []
    for (const element of Array.from(document.querySelectorAll<HTMLElement>('button, a, [role="radio"], [role="tab"], span, h1, h2, h3, p, label'))) {
      // sr-only copies (1 px boxes) are not shown
      if (!element.offsetParent || element.children.length > 2 || element.clientWidth <= 1) continue
      const text = element.textContent?.trim() ?? ''
      if (!/[а-яё]/i.test(text)) continue
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
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru')
  await shot(page, 'b-login-signup-390')
  await page.getByLabel('Эл. почта', { exact: true }).fill('mila@example.test')
  await page.getByRole('checkbox').nth(0).check()
  await page.getByRole('checkbox').nth(1).check()
  await shot(page, 'b-login-signup-checked-390')
  await page.getByRole('button', { name: 'Отправить код', exact: true }).click()
  await expect(page.getByLabel('Шестизначный код', { exact: true })).toBeVisible()
  await shot(page, 'c-code-390')
  await page.getByLabel('Шестизначный код', { exact: true }).fill('123456')
  await expect(page.getByLabel('Имя', { exact: true })).toBeVisible()
  await shot(page, 'd-profile-name-390')
  await page.getByLabel('Имя', { exact: true }).fill('Мила')
  await page.getByRole('button', { name: 'Готово', exact: true }).click()
  await page.getByRole('button', { name: 'Пропустить', exact: true }).click()
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
    await lists.createList({ id: birthday, title: 'Мой день рождения', visibility: 'followers', cover_tone: 3, cover_icon: 'cake', due_on: null })
    await listPhotos.uploadListPhoto(birthday, cover)
    const books = lists.newListId()
    await lists.createList({ id: books, title: 'Книги', visibility: 'private', cover_tone: 1, cover_icon: 'book', due_on: null })

    const add = async (listId: string, input: object, withPhoto: boolean) => {
      const wish = await wishes.createWish(listId, input)
      if (withPhoto) await wishPhotos.uploadWishPhoto(wish.id, product)
    }
    await add(birthday, { title: 'Кофемолка с керамическими жерновами', price_cents: 8990, url: 'https://www.amazon.de/dp/B000TEST01', priority: 3, brand: 'Kegel', color: 'Орех', description: 'Ручная кофемолка из орехового дерева. Помол настраивается от мелкого (эспрессо) до крупного (френч-пресс).' }, true)
    await add(birthday, { title: 'Сертификат в кино', price_cents: 2500, url: null, priority: 2 }, false)
    await add(birthday, { title: 'Туристический рюкзак 30 л', price_cents: 12900, url: 'https://www.zalando.de/rucksack-test', priority: 2 }, true)
    await add(birthday, { title: 'Растение для балкона', price_cents: null, url: 'https://www.ikea.com/de/de/p/test', priority: 1 }, false)
    await add(books, { title: 'Хоббит', price_cents: 1400, url: null, priority: 2 }, false)

    const inFiveDays = new Date(Date.now() + 5 * 86_400_000)
    inFiveDays.setUTCHours(16, 0, 0, 0)
    await occasions.createOccasion({ title: 'День рождения Милы', starts_at: inFiveDays.toISOString(), tz: 'Europe/Berlin', all_day: false, place_text: 'Кафе у рынка' })
    // Start was already open: let the app's own cache fetch the new world
    const query = (await import(/* @vite-ignore */ '/src/lib/query.ts')) as { queryClient: { invalidateQueries: () => Promise<void> } }
    await query.queryClient.invalidateQueries()
    return { birthday, books }
  })
}

test('Bunprise in Russian: the main screens at 390 and 320 px', async ({ page }) => {
  test.setTimeout(300_000)
  const errors: string[] = []
  const cut: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await solidMaterials(page)

  await page.goto('/?frame=0')
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru')
  await shot(page, 'a-start-landing-390')
  await report(page, 'landing', cut)

  await signUp(page)
  await seed(page)

  const nav = page.getByRole('navigation', { name: 'Главное меню' })
  await nav.getByRole('link', { name: /^Главная/ }).click()
  await expect(page.getByText('День рождения Милы').first()).toBeVisible()
  await shot(page, 'e-start-list-390')
  await report(page, 'start list', cut)
  await page.getByRole('radio', { name: 'Месяц', exact: true }).click()
  await shot(page, 'f-start-month-390')
  await report(page, 'start month', cut)
  await page.mouse.wheel(0, 500)
  await shot(page, 'f-start-month-agenda-390')
  await page.getByRole('radio', { name: 'Список', exact: true }).click()
  await settle(page)

  // an occasion of the demo world as a guest: the RSVP control "Приду / Возможно / Не приду"
  await page.getByRole('link', { name: /Annas Einweihung/ }).first().click()
  await expect(page.getByRole('radiogroup', { name: 'Твой ответ' })).toBeAttached({ timeout: 15_000 })
  await shot(page, 'g-occasion-guest-390')
  await page.getByRole('radiogroup', { name: 'Твой ответ' }).scrollIntoViewIfNeeded()
  await shot(page, 'g-occasion-guest-rsvp-390')
  await report(page, 'occasion', cut)
  await page.mouse.wheel(0, 700)
  await shot(page, 'g-occasion-guest-wishes-390')
  await page.goBack()
  await settle(page)

  await nav.getByRole('link', { name: /^Списки/ }).click()
  await expect(page.getByRole('link', { name: /Мой день рождения/ })).toBeVisible()
  await shot(page, 'h-lists-mine-390')
  await report(page, 'lists mine', cut)
  await page.getByRole('radio', { name: 'Друзья', exact: true }).click()
  await shot(page, 'i-lists-friends-390')
  await report(page, 'lists friends', cut)
  await page.mouse.wheel(0, 600)
  await shot(page, 'i-lists-friends-scrolled-390')
  await page.getByRole('radio', { name: 'Мои', exact: true }).click()
  await settle(page)

  await page.getByRole('link', { name: /Мой день рождения/ }).click()
  await expect(page.getByRole('button', { name: /Кофемолка/ }).first()).toBeVisible({ timeout: 15_000 })
  await shot(page, 'j-list-hero-390')
  await page.mouse.wheel(0, 400)
  await shot(page, 'j-list-wish-tiles-390')
  await report(page, 'list', cut)

  await page.getByRole('button', { name: 'Ещё: «Сертификат в кино»' }).click()
  await shot(page, 'k-wish-menu-390')
  await report(page, 'wish menu', cut)
  await page.keyboard.press('Escape')
  await settle(page)
  await page.getByRole('button', { name: 'Ещё: «Сертификат в кино»' }).click()
  await page.getByRole('button', { name: 'Насколько хочется?' }).click()
  await shot(page, 'k-priority-390')
  await report(page, 'priority', cut)
  await page.keyboard.press('Escape')
  await settle(page)

  await page.getByRole('button', { name: /Кофемолка/ }).first().click()
  await shot(page, 'l-wish-sheet-390')
  await report(page, 'wish sheet', cut)
  await page.keyboard.press('Escape')
  await settle(page)
  await page.goBack()
  await settle(page)

  await nav.getByRole('button', { name: 'Создать' }).click()
  await shot(page, 'm-plus-menu-390')
  await report(page, 'plus menu', cut)
  await page.keyboard.press('Escape')
  await settle(page)

  await nav.getByRole('link', { name: /^Идеи/ }).click()
  await expect(page.getByRole('region', { name: 'Идеи подарков' }).getByRole('article').first()).toBeVisible({ timeout: 30_000 })
  await shot(page, 'n-ideas-390')
  await report(page, 'ideas', cut)
  await page.getByRole('radio', { name: 'Для себя', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Идеи подарков' }).getByRole('article').first()).toBeVisible({ timeout: 30_000 })
  await shot(page, 'n-ideas-me-390')
  await report(page, 'ideas me', cut)

  await nav.getByRole('link', { name: /^Профиль/ }).click()
  await expect(page.getByRole('radiogroup', { name: 'Язык' })).toBeAttached({ timeout: 15_000 })
  await shot(page, 'o-profile-390')
  await page.getByRole('radiogroup', { name: 'Язык' }).scrollIntoViewIfNeeded()
  await shot(page, 'o-profile-language-390')
  await report(page, 'profile', cut)
  await page.mouse.wheel(0, 1600)
  await shot(page, 'o-profile-bottom-390')

  // 320 px
  await page.setViewportSize({ width: 320, height: 700 })
  await page.mouse.wheel(0, -4000)
  await page.getByRole('radiogroup', { name: 'Язык' }).scrollIntoViewIfNeeded()
  await shot(page, 'p-profile-language-320')
  await report(page, 'profile 320', cut)
  await nav.getByRole('link', { name: /^Главная/ }).click()
  await shot(page, 'q-start-list-320')
  await report(page, 'start 320', cut)
  await page.getByRole('radio', { name: 'Месяц', exact: true }).click()
  await shot(page, 'q-start-month-320')
  await report(page, 'month 320', cut)
  await page.getByRole('radio', { name: 'Список', exact: true }).click()
  await settle(page)
  await page.getByRole('link', { name: /Annas Einweihung/ }).first().click()
  await expect(page.getByRole('radiogroup', { name: 'Твой ответ' })).toBeAttached({ timeout: 15_000 })
  await page.getByRole('radiogroup', { name: 'Твой ответ' }).scrollIntoViewIfNeeded()
  await shot(page, 'r-occasion-guest-rsvp-320')
  await report(page, 'occasion 320', cut)
  await page.goBack()
  await settle(page)
  await nav.getByRole('link', { name: /^Списки/ }).click()
  await shot(page, 's-lists-mine-320')
  await report(page, 'lists 320', cut)
  await page.getByRole('radio', { name: 'Друзья', exact: true }).click()
  await shot(page, 's-lists-friends-320')
  await report(page, 'friends 320', cut)
  await page.getByRole('radio', { name: 'Мои', exact: true }).click()
  await settle(page)
  await page.getByRole('link', { name: /Мой день рождения/ }).click()
  await expect(page.getByRole('button', { name: /Кофемолка/ }).first()).toBeVisible({ timeout: 15_000 })
  await page.mouse.wheel(0, 400)
  await shot(page, 't-list-wish-tiles-320')
  await report(page, 'list 320', cut)
  await page.getByRole('button', { name: /Кофемолка/ }).first().click()
  await shot(page, 't-wish-sheet-320')
  await report(page, 'wish sheet 320', cut)
  await page.keyboard.press('Escape')
  await settle(page)
  await page.goBack()
  await settle(page)
  await nav.getByRole('button', { name: 'Создать' }).click()
  await shot(page, 'u-plus-menu-320')
  await report(page, 'plus menu 320', cut)
  await page.keyboard.press('Escape')
  await settle(page)
  await nav.getByRole('link', { name: /^Идеи/ }).click()
  await expect(page.getByRole('region', { name: 'Идеи подарков' }).getByRole('article').first()).toBeVisible({ timeout: 30_000 })
  await shot(page, 'v-ideas-320')
  await report(page, 'ideas 320', cut)

  // a legal page from the profile: the German text with the Russian note on top
  await nav.getByRole('link', { name: /^Профиль/ }).click()
  await page.getByRole('link', { name: /Условия использования/ }).click()
  await expect(page.getByText('Юридические тексты есть только на немецком и английском языках. Ниже — немецкая версия.')).toBeVisible({ timeout: 15_000 })
  await shot(page, 'w-legal-terms-320')

  console.log('cut or overflowing Russian text:', cut.length ? `\n  ${cut.join('\n  ')}` : 'none')
  console.log('page errors:', errors.length ? errors.join(' | ') : 'none')
})

test('Bunprise in Russian: before sign-in at 320 px', async ({ page }) => {
  const cut: string[] = []
  await solidMaterials(page)
  await page.setViewportSize({ width: 320, height: 700 })
  await page.goto('/?frame=0')
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru')
  await shot(page, 'x-start-landing-320')
  await report(page, 'landing 320', cut)
  await page.goto('/login?mode=signup&method=email&frame=0')
  await expect(page.getByLabel('Эл. почта', { exact: true })).toBeVisible()
  await shot(page, 'y-login-signup-320')
  await report(page, 'login 320', cut)
  await page.goto('/login?frame=0')
  await expect(page.getByRole('link', { name: /Google/ })).toBeVisible()
  await shot(page, 'y-login-methods-320')
  await report(page, 'login methods 320', cut)
  console.log('cut or overflowing Russian text (320, signed out):', cut.length ? `\n  ${cut.join('\n  ')}` : 'none')
})
