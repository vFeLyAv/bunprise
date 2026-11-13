/**
 * Gallery page «Значки приложения» (Felix 27.10) — every home-screen icon of Einstellungen → App-Symbol on mock home
 * screens, so they can be judged where they will live: an iPhone home screen (the 180 px Apple touch icon, iOS rounds
 * the corners) on a light and a dark wallpaper, an Android one (the maskable icon, cut to a circle like most launchers)
 * and every icon large with its name. The files are the app's own (apps/web/public/icons, drawn by
 * apps/web/scripts/app-icons.mjs); this page only shows them.
 *
 *   ?screens=icons [&theme=dark] [&view=phones]   (view=phones: only the two iPhone home screens, for screenshots)
 */

import { addCss, applyPageTheme, el, markReady, themeOf } from '../parade/kit';

/** The picker's order and names (apps/web/src/features/account/appIconVariants.ts, settings.json app_icon_*). */
const ICONS: ReadonlyArray<readonly [id: string, ru: string, de: string]> = [
  ['classic', 'Классика', 'Klassisch'],
  ['dark', 'Тёмный', 'Dunkel'],
  ['night', 'Ночь', 'Nacht'],
  ['ocean', 'Океан', 'Ozean'],
  ['mono', 'Простой', 'Schlicht'],
  ['tapsi', 'С Тапси', 'Mit Tapsi'],
  ['birthday', 'День рождения', 'Geburtstag'],
  ['easter', 'Пасха', 'Ostern'],
  ['summer', 'Лето', 'Sommer'],
  ['autumn', 'Осень', 'Herbst'],
  ['halloween', 'Хэллоуин', 'Halloween'],
  ['christmas', 'Рождество', 'Weihnachten'],
];

// The app's own files (Vite turns each `new URL(…, import.meta.url)` into a file URL of the dev server; the ones with
// ${id} become a lookup over the matching files).
const CLASSIC = {
  apple: new URL('../../../../apps/web/public/apple-touch-icon.png', import.meta.url).href,
  maskable: new URL('../../../../apps/web/public/icons/icon-192-maskable.png', import.meta.url).href,
  svg: new URL('../../../../apps/web/public/icons/icon.svg', import.meta.url).href,
};
/** iOS: the Apple touch icon; Android: the maskable PNG; large: the vector. */
function file(id: string, kind: 'apple' | 'maskable' | 'svg'): string {
  if (id === 'classic') return CLASSIC[kind];
  if (kind === 'apple') return new URL(`../../../../apps/web/public/icons/variants/${id}/apple-touch-icon.png`, import.meta.url).href;
  if (kind === 'maskable') return new URL(`../../../../apps/web/public/icons/variants/${id}/icon-192-maskable.png`, import.meta.url).href;
  return new URL(`../../../../apps/web/public/icons/variants/${id}/icon.svg`, import.meta.url).href;
}

const CSS = `
.ai-page { max-width: 1240px; margin: 0 auto; padding: 8px 16px 48px; box-sizing: border-box; color: var(--text); }
.ai-page h2 { margin: 6px 0 4px; font-size: 24px; letter-spacing: -.02em; }
.ai-page h3 { margin: 30px 0 10px; font-size: 18px; }
.ai-lead { margin: 0 0 18px; color: var(--text-2); font-size: 14px; max-width: 820px; line-height: 1.45; }
.ai-phones { display: flex; flex-wrap: wrap; gap: 40px; align-items: flex-start; padding: 12px; }
.ai-phone { position: relative; width: 390px; height: 844px; flex: none; border-radius: 48px; overflow: hidden; box-sizing: border-box;
  box-shadow: 0 0 0 10px #1D1D1F, 0 30px 70px rgba(40,25,10,.25); font: 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
.ai-phone.light { background: radial-gradient(80% 50% at 10% 0%, #FFD9C2 0%, transparent 70%), radial-gradient(70% 50% at 100% 40%, #D9D2FA 0%, transparent 70%),
  radial-gradient(90% 50% at 0% 100%, #C9EBF2 0%, transparent 70%), linear-gradient(#FBEFE6, #EAE7F7 55%, #DDEFF3); }
.ai-phone.dark { background: radial-gradient(80% 50% at 10% 0%, rgba(255,140,90,.32) 0%, transparent 70%), radial-gradient(70% 50% at 100% 45%, rgba(110,90,220,.35) 0%, transparent 70%),
  radial-gradient(90% 50% at 0% 100%, rgba(40,140,170,.3) 0%, transparent 70%), linear-gradient(#17151F, #1B1830 55%, #101820); }
.ai-status { display: flex; justify-content: space-between; padding: 16px 32px 0; font-size: 16px; font-weight: 600; }
.ai-phone.light .ai-status { color: #1C1C1E; } .ai-phone.dark .ai-status { color: #FFFFFF; }
.ai-grid { display: grid; grid-template-columns: repeat(4, 64px); justify-content: space-between; row-gap: 26px; padding: 40px 27px 0; }
.ai-app { display: flex; flex-direction: column; align-items: center; gap: 6px; width: 64px; }
.ai-app img { width: 64px; height: 64px; border-radius: 22.5%; display: block; box-shadow: 0 1px 3px rgba(0,0,0,.18); }
.ai-app span { width: 76px; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 12px; letter-spacing: -.01em; }
.ai-phone.light .ai-app span { color: #1C1C1E; } .ai-phone.dark .ai-app span { color: #FFFFFF; text-shadow: 0 1px 2px rgba(0,0,0,.5); }
.ai-dock { position: absolute; left: 14px; right: 14px; bottom: 18px; height: 96px; border-radius: 34px; display: flex; justify-content: space-around; align-items: center; }
.ai-phone.light .ai-dock { background: rgba(255,255,255,.42); } .ai-phone.dark .ai-dock { background: rgba(255,255,255,.12); }
.ai-dock i { width: 64px; height: 64px; border-radius: 22.5%; background: rgba(255,255,255,.55); }
.ai-phone.dark .ai-dock i { background: rgba(255,255,255,.16); }
.ai-android { display: grid; grid-template-columns: repeat(6, 92px); gap: 18px 10px; padding: 22px; border-radius: 28px; width: fit-content;
  background: linear-gradient(135deg, #3C4A6B, #6B4E73 60%, #A0645A); }
.ai-android .ai-app img { width: 58px; height: 58px; border-radius: 50%; box-shadow: none; }
.ai-android .ai-app { width: 92px; } .ai-android .ai-app span { color: #FFFFFF; width: 90px; }
.ai-large { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 22px; }
.ai-tile { display: flex; flex-direction: column; align-items: center; gap: 8px; font-size: 13px; color: var(--text-2); text-align: center; }
.ai-tile img { width: 132px; height: 132px; border-radius: 22.5%; box-shadow: 0 6px 18px -8px rgba(60,30,10,.4); }
.ai-tile b { color: var(--text); font-size: 14px; }
.ai-sizes { display: flex; flex-wrap: wrap; gap: 28px; align-items: flex-end; }
.ai-sizes .ai-row { display: flex; gap: 10px; align-items: flex-end; }
.ai-sizes img { border-radius: 22.5%; display: block; }
`;

function app(id: string, label: string, kind: 'apple' | 'maskable'): HTMLElement {
  const item = el('div', 'ai-app');
  const img = el('img');
  img.src = file(id, kind);
  img.alt = '';
  item.append(img, el('span', undefined, label));
  return item;
}

function phone(theme: 'light' | 'dark'): HTMLElement {
  const box = el('div', `ai-phone ${theme}`);
  box.append(el('div', 'ai-status', '<span>9:41</span><span>●●● ▮</span>'));
  const grid = el('div', 'ai-grid');
  for (const [id, , de] of ICONS) grid.append(app(id, de, 'apple'));
  box.append(grid);
  const dock = el('div', 'ai-dock');
  for (let i = 0; i < 4; i++) dock.append(el('i'));
  box.append(dock);
  return box;
}

export function appIconsGallery(root: HTMLElement, q: URLSearchParams): void {
  addCss('ai-css', CSS);
  applyPageTheme(themeOf(q));
  const page = el('section', 'ai-page');
  root.append(page);
  const phonesOnly = q.get('view') === 'phones';
  if (!phonesOnly) {
    page.append(
      el('h2', undefined, 'Значки приложения — выбор в «Einstellungen → App-Symbol»'),
      el('p', 'ai-lead', '12 значков: классический + 11 вариантов (5 сезонных из docs/brand/variants и 6 новых: Ночь, Океан, Простой, С Тапси, Лето, Осень). Ниже — как они выглядят на экране «Домой» iPhone (файл apple-touch-icon 180 px; углы скругляет сам iOS) на светлых и тёмных обоях, на Android (maskable-иконка, обрезанная в круг) и крупно. Телефон берёт значок в момент «Добавить на экран „Домой“»; уже установленное приложение само его не меняет (iPhone — никогда, Android — иногда сам через день).'),
    );
  }
  const phones = el('div', 'ai-phones');
  phones.append(phone('light'), phone('dark'));
  page.append(phones);
  if (!phonesOnly) {
    page.append(el('h3', undefined, 'Android: maskable-иконки в круге (безопасная зона 80 %)'));
    const android = el('div', 'ai-android');
    for (const [id, ru] of ICONS) android.append(app(id, ru, 'maskable'));
    page.append(android);

    page.append(el('h3', undefined, 'Мелко: 60 · 40 · 29 px (читается ли кролик)'));
    const sizes = el('div', 'ai-sizes');
    for (const [id] of ICONS) {
      const row = el('div', 'ai-row');
      for (const px of [60, 40, 29]) {
        const img = el('img');
        img.src = file(id, 'apple');
        img.width = px;
        img.height = px;
        img.alt = '';
        row.append(img);
      }
      sizes.append(row);
    }
    page.append(sizes);

    page.append(el('h3', undefined, 'Крупно (вектор icon.svg)'));
    const large = el('div', 'ai-large');
    for (const [id, ru, de] of ICONS) {
      const tile = el('div', 'ai-tile');
      const img = el('img');
      img.src = file(id, 'svg');
      img.alt = '';
      tile.append(img, el('b', undefined, ru), el('span', undefined, `${de} · ${id}`));
      large.append(tile);
    }
    page.append(large);
  }
  const images = Array.from(page.querySelectorAll('img'));
  void Promise.all(images.map((img) => img.decode().catch(() => undefined))).then(markReady);
}
