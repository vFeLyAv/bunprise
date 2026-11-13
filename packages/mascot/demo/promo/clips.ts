/**
 * Every clip the promo player can show and the renderer can record (?screens=film&clip=<id>):
 * its stage size in CSS px (the renderer multiplies it by its --scale), how to build it and its scene jumps.
 * Felix 25.10: the main film (portrait), the «Add to Home Screen» instructions (portrait) and 16:9 GIF banners
 * (e.g. for the Telegram bot later). All clips are dark (Felix: «оставляем только тёмную тему»).
 */
import { BANNER_H, BANNER_LENGTH, BANNER_W, buildBannerBrand, buildBannerDream, buildBannerSecret } from './banners';
import type { Film } from './film';
import { INSTALL_ANDROID_LENGTH, INSTALL_IOS_LENGTH, buildInstallAndroid, buildInstallIos } from './install';
import { buildFilm } from './scenes';

export interface Clip {
  id: string;
  title: string;
  note: string;
  /** stage size, CSS px */
  w: number;
  h: number;
  build(film: Film): void;
  scenes: readonly { label: string; at: number }[];
  /** 'video' = MP4 with sound, 'gif' = a silent loop */
  kind: 'video' | 'gif';
}

export const CLIPS: Clip[] = [
  {
    id: 'main',
    title: 'Основной ролик (~36 с)',
    note: 'Шесть сцен: крючок, событие, желания, приглашение, тайная бронь, финал.',
    w: 360,
    h: 640,
    build: buildFilm,
    kind: 'video',
    scenes: [
      { label: '1 · Крючок', at: 0 },
      { label: '2 · Событие', at: 3.4 },
      { label: '3 · Желания', at: 10 },
      { label: '4 · Приглашение', at: 17 },
      { label: '5 · Тайная бронь', at: 22.2 },
      { label: '6 · Финал', at: 30.4 },
    ],
  },
  {
    id: 'install-ios',
    title: `Инструкция: iPhone (~${INSTALL_IOS_LENGTH} с)`,
    note: '«Add to Home Screen» в Safari: Share → Add to Home Screen → Add. Свой упрощённый браузер, без логотипов Apple.',
    w: 360,
    h: 640,
    build: buildInstallIos,
    kind: 'video',
    scenes: [
      { label: 'Привет', at: 0 },
      { label: '1 · Share', at: 3.1 },
      { label: '2 · Add to Home Screen', at: 6.4 },
      { label: '3 · Add', at: 9.6 },
      { label: 'Готово', at: 13.6 },
    ],
  },
  {
    id: 'install-android',
    title: `Инструкция: Android (~${INSTALL_ANDROID_LENGTH} с)`,
    note: '«Add to Home screen» в Chrome: меню ⋮ → Add to Home screen / Install app → Install. Свой упрощённый браузер, без логотипов Google.',
    w: 360,
    h: 640,
    build: buildInstallAndroid,
    kind: 'video',
    scenes: [
      { label: 'Привет', at: 0 },
      { label: '1 · Меню ⋮', at: 3.1 },
      { label: '2 · Add to Home screen', at: 6.2 },
      { label: '3 · Install', at: 9.3 },
      { label: 'Готово', at: 13.1 },
    ],
  },
  ...([
    ['banner-brand', 'Баннер 16:9: Bunprise', 'Помпон и Тапси рядом с названием, строкой и адресом.', buildBannerBrand],
    ['banner-secret', 'Баннер 16:9: тайная бронь', 'Желание с «Reserved», Тапси прячет подарок, подмигивает.', buildBannerSecret],
    ['banner-dream', 'Баннер 16:9: Dream big!', 'Маленький праздник: прыжки и конфетти.', buildBannerDream],
  ] as const).map(([id, title, note, build]): Clip => ({
    id,
    title,
    note: `${note} Бесшовная петля ${BANNER_LENGTH} с, без звука (GIF / MP4 для Telegram).`,
    w: BANNER_W,
    h: BANNER_H,
    build,
    kind: 'gif',
    scenes: [{ label: 'Начало петли', at: 0 }],
  })),
];

export function clipById(id: string | null): Clip {
  return CLIPS.find((c) => c.id === id) ?? (CLIPS[0] as Clip);
}
