/**
 * The phone mock for the Mitbringen moment (gallery only): the occasion screen at 390 px with the "Mitbringen"
 * section as the app draws it (apps/web/src/features/potluck/PotluckSection.tsx — title, "n von m verteilt", the
 * permanent "Hier sieht jeder …" line, "Du bringst: …", the frosted card with 72 px rows, "Alles ist verteilt"),
 * German strings from locales/de/occasion.json, colours from apps/web/src/styles/tokens.css + kit.css (Paper light and
 * "Paper at night"), copied here as plain values (the gallery cannot import the app's CSS).
 *
 * The UI's own reaction to the tap is authored on the SAME timeline as the mascot (tracks, transform/opacity only):
 * the button presses and spins while the server answers, then the row turns into "Du · Doch nicht", the counter
 * changes, and the new item shows up in "Du bringst" when the basket melts into the line's highlight; for the last
 * free item "Alles ist verteilt. Danke!" shows with Pompon's binky.
 */

import { Track } from '../../src/timeline';
import { E } from '../../src/welcome-actors';

/** basket = «Корзинка» (the item is not the last free one); last = the last free item (the basket + the binky). */
export type Variant = 'basket' | 'last';
export type Theme = 'light' | 'dark';

/** Seconds of the tap before the server's "yes" (moment time 0 = the server confirmed). */
export const PRE = 0.6;

const LIGHT = `
  --bg:#F2EBDD; --page-top:#F7F0E5; --page-mid:#F3EADC; --page-bottom:#F0E6D6;
  --glow-1:rgba(255,193,146,.58); --glow-2:rgba(248,180,170,.46); --glow-3:rgba(252,206,126,.5); --glow-4:rgba(204,194,242,.42);
  --panel-bg:rgba(255,252,246,.62); --panel-sheen:linear-gradient(180deg,rgba(255,255,255,.5) 0%,transparent 42%);
  --panel-edge:inset 0 0 0 1px rgba(255,255,255,.62),inset 0 1px 0 rgba(255,255,255,.95);
  --panel-shadow:0 1px 2px rgba(80,50,22,.05),0 12px 30px -14px rgba(92,56,24,.26);
  --float-bg:rgba(255,253,248,.72); --float-edge:inset 0 0 0 1px rgba(255,255,255,.7);
  --text:#2A231C; --text-2:#62554A; --text-3:#85786A; --accent-text:#984A14; --separator:rgba(116,84,44,.15);
  --fill:rgba(116,84,44,.07); --fill-2:rgba(116,84,44,.11); --thumb:#FFFDF8; --hl-pill:#FCE5C9;
  --av-1:#F8D0A2; --av-1-ink:#783910; --av-2:#DCEBCB; --av-2-ink:#2D5A31;
  --mascot-shadow:rgba(70,40,15,.20); --mascot-outline:rgba(224,171,116,.5);`;
const DARK = `
  --bg:#17120F; --page-top:#1C1612; --page-mid:#18130F; --page-bottom:#15100D;
  --glow-1:rgba(255,150,84,.13); --glow-2:rgba(232,118,124,.10); --glow-3:rgba(236,172,82,.10); --glow-4:rgba(150,132,226,.09);
  --panel-bg:rgba(46,37,31,.72); --panel-sheen:linear-gradient(180deg,rgba(255,236,214,.05) 0%,transparent 42%);
  --panel-edge:inset 0 0 0 1px rgba(255,236,214,.075),inset 0 1px 0 rgba(255,236,214,.11);
  --panel-shadow:0 1px 2px rgba(0,0,0,.3),0 12px 30px -14px rgba(0,0,0,.55);
  --float-bg:rgba(52,42,35,.72); --float-edge:inset 0 0 0 1px rgba(255,236,214,.08);
  --text:#F5EDE3; --text-2:#C3B5A6; --text-3:#918377; --accent-text:#F2A25A; --separator:rgba(255,230,205,.13);
  --fill:rgba(255,230,205,.075); --fill-2:rgba(255,230,205,.115); --thumb:#4B3E34; --hl-pill:#553A22;
  --av-1:#553A22; --av-1-ink:#FFC58A; --av-2:#24361F; --av-2-ink:#B7DDA6;
  --mascot-shadow:rgba(0,0,0,.42); --mascot-outline:rgba(255,214,170,.2);`;

export const MOCK_CSS = `
.mbx-phone { ${LIGHT} position: relative; width: 390px; height: 780px; border-radius: 46px; overflow: hidden; flex: none;
  background: var(--bg); color: var(--text); box-shadow: 0 0 0 10px #1D1D1F, 0 30px 70px rgba(60,40,20,.28);
  font: 15px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI Variable", "Segoe UI", Roboto, "Helvetica Neue", Arial, system-ui, sans-serif;
  -webkit-font-smoothing: antialiased; text-align: left; isolation: isolate; }
.mbx-phone[data-theme="dark"] { ${DARK} }
.mbx-screen { position: absolute; inset: 0; background:
  radial-gradient(78% 36% at -4% -2%, var(--glow-1) 0%, transparent 72%), radial-gradient(70% 34% at 104% 30%, var(--glow-2) 0%, transparent 72%),
  radial-gradient(84% 34% at 4% 98%, var(--glow-3) 0%, transparent 72%), radial-gradient(72% 30% at 102% 80%, var(--glow-4) 0%, transparent 72%),
  linear-gradient(180deg, var(--page-top) 0%, var(--page-mid) 55%, var(--page-bottom) 100%); }
.mbx-bar { position: absolute; left: 12px; right: 12px; top: 14px; height: 44px; display: flex; align-items: center; justify-content: space-between; }
.mbx-pill { height: 44px; display: inline-flex; align-items: center; gap: 4px; padding: 0 16px 0 12px; border-radius: 999px; background: var(--float-bg);
  box-shadow: var(--float-edge), 0 6px 16px rgba(70,45,20,.10); font-weight: 600; font-size: 17px; }
.mbx-pill.round { width: 44px; padding: 0; justify-content: center; font-size: 20px; letter-spacing: 1px; }
.mbx-bar b { position: absolute; left: 50%; transform: translateX(-50%); font-size: 17px; font-weight: 600; white-space: nowrap; }
.mbx-content { position: absolute; left: 16px; right: 16px; top: 76px; }
.mbx-seg { display: grid; grid-template-columns: 1fr 1fr; height: 44px; padding: 4px; box-sizing: border-box; border-radius: 999px; background: var(--fill-2); margin-bottom: 24px; }
.mbx-seg span { display: grid; place-items: center; border-radius: 999px; font-weight: 600; font-size: 15px; color: var(--text-2); }
.mbx-seg .on { background: var(--thumb); color: var(--text); box-shadow: 0 1px 2px rgba(70,45,20,.08), 0 4px 10px rgba(70,45,20,.08); }
.mbx-section { display: flex; flex-direction: column; gap: 12px; }
.mbx-h2 { margin: 0; font-size: 22px; line-height: 28px; font-weight: 700; letter-spacing: -.02em; }
.mbx-progress { position: relative; display: block; margin-top: 4px; font-size: 13px; line-height: 18px; color: var(--text-2); }
.mbx-progress .new { position: absolute; left: 0; top: 0; }
.mbx-public { margin: 0; font-size: 13px; line-height: 18px; color: var(--text-2); }
.mbx-you { position: relative; margin: 0; font-size: 15px; line-height: 20px; font-weight: 600; color: var(--accent-text); white-space: nowrap; }
.mbx-you .txt { position: relative; z-index: 1; }
.mbx-hl { position: absolute; left: -8px; top: -4px; bottom: -4px; border-radius: 999px; background: var(--hl-pill); opacity: 0; }
.mbx-card { position: relative; border-radius: 24px; background-color: var(--panel-bg); background-image: var(--panel-sheen); box-shadow: var(--panel-edge), var(--panel-shadow); }
.mbx-card ul { margin: 0; padding: 0; list-style: none; }
.mbx-row { position: relative; display: flex; align-items: center; gap: 12px; min-height: 72px; padding: 12px 16px; box-sizing: border-box; }
.mbx-row + .mbx-row::before { content: ""; position: absolute; left: 16px; right: 0; top: 0; height: 1px; background: var(--separator); }
.mbx-main { flex: 1; min-width: 0; position: relative; }
.mbx-title { display: block; font-size: 17px; line-height: 22px; font-weight: 600; }
.mbx-sub { display: block; margin-top: 2px; font-size: 15px; line-height: 20px; color: var(--text-2); }
.mbx-row[data-only-title] .mbx-main { display: flex; align-items: center; min-height: 44px; }
.mbx-trail { position: relative; flex: none; display: flex; align-items: center; justify-content: flex-end; min-width: 112px; height: 36px; }
.mbx-trail > * { position: absolute; right: 0; top: 0; height: 36px; display: flex; align-items: center; }
.mbx-btn { box-sizing: border-box; padding: 0 12px; border-radius: 999px; background: var(--fill); color: var(--text); font-size: 15px; font-weight: 600; white-space: nowrap; }
.mbx-btn .lbl { display: block; }
.mbx-spin { position: absolute; left: 50%; top: 50%; width: 16px; height: 16px; margin: -8px 0 0 -8px; border-radius: 50%; border: 2px solid var(--fill-2); border-top-color: var(--text-2); box-sizing: border-box; opacity: 0; }
.mbx-mine { gap: 0; font-size: 15px; font-weight: 600; color: var(--accent-text); white-space: nowrap; }
.mbx-mine .ghost { padding: 0 12px; }
.mbx-av { width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; font-size: 13px; font-weight: 700; }
.mbx-done { margin: 0; font-size: 13px; line-height: 18px; color: var(--text-2); }
.mbx-add { align-self: flex-start; height: 44px; display: inline-flex; align-items: center; gap: 8px; padding: 0 16px; color: var(--accent-text); font-size: 17px; font-weight: 600; }
.mbx-add i { font-style: normal; font-size: 24px; font-weight: 400; margin-top: -2px; }
.mbx-layer { position: absolute; inset: 0; pointer-events: none; }
`;

interface RowSpec {
  title: string;
  /** the 'open' row is claimed by "you" in the moment; a 'free' row stays free */
  who: 'anna' | 'klara' | 'me' | 'open' | 'free';
}

const ROWS: Record<Variant, RowSpec[]> = {
  // the 2nd row is free (the bunny comes from its right end), "Knabberzeug" is already mine, "Salat" stays free (so
  // this is NOT the last free item: 3 → 4 von 5)
  basket: [
    { title: 'Sekt zum Anstoßen', who: 'anna' },
    { title: 'Kuchen', who: 'open' },
    { title: 'Knabberzeug', who: 'me' },
    { title: 'Musikbox', who: 'klara' },
    { title: 'Salat', who: 'free' },
  ],
  // the last free item, after it "4 von 4 verteilt" — "Kuchen" is the 2nd row here too, so the bunny comes in exactly
  // as in the basket moment (the same row height, the same two hops)
  last: [
    { title: 'Sekt zum Anstoßen', who: 'anna' },
    { title: 'Kuchen', who: 'open' },
    { title: 'Knabberzeug', who: 'me' },
    { title: 'Musikbox', who: 'klara' },
  ],
};

const MINE = `<span class="mbx-mine" data-k="mine"><span>Du</span><span class="ghost">Doch nicht</span></span>`;

function rowMarkup(r: RowSpec): string {
  if (r.who === 'free') return `<li class="mbx-row"><span class="mbx-main"><span class="mbx-title">${r.title}</span><span class="mbx-sub">Noch offen</span></span><span class="mbx-trail"><span class="mbx-btn">Ich bring’s mit</span></span></li>`;
  if (r.who === 'me') return `<li class="mbx-row" data-only-title><span class="mbx-main"><span class="mbx-title">${r.title}</span></span><span class="mbx-trail">${MINE}</span></li>`;
  if (r.who === 'open') {
    // both states are there from the start (the answer crossfades in place, nothing reflows)
    return `<li class="mbx-row" data-claim><span class="mbx-main"><span class="mbx-title" data-k="title">${r.title}</span><span class="mbx-sub" data-k="sub">Noch offen</span></span>`
      + `<span class="mbx-trail"><span class="mbx-btn" data-k="btn"><span class="lbl" data-k="lbl">Ich bring’s mit</span><span class="mbx-spin" data-k="spin"></span></span>${MINE.replace('data-k="mine"', 'data-k="mine-new" style="opacity:0"')}</span></li>`;
  }
  const name = r.who === 'anna' ? 'Anna' : 'Klara';
  const av = r.who === 'anna' ? 'background:var(--av-1);color:var(--av-1-ink)' : 'background:var(--av-2);color:var(--av-2-ink)';
  return `<li class="mbx-row"><span class="mbx-main"><span class="mbx-title">${r.title}</span><span class="mbx-sub">${name} bringt es mit</span></span>`
    + `<span class="mbx-trail" style="min-width:0"><span class="mbx-av" style="${av}">${name[0]}</span></span></li>`;
}

export interface MockRefs {
  phone: HTMLElement;
  screen: HTMLElement;
  card: HTMLElement;
  /** the claimed row (<li>) */
  claim: HTMLElement;
  you: HTMLElement;
  youNew: HTMLElement;
  hl: HTMLElement;
  /** the overlay layers: under-the-mascot props and the mascot */
  layer: HTMLElement;
  q: <T extends Element = HTMLElement>(key: string) => T;
}

/** Builds the phone (not yet in the document). */
export function buildMock(variant: Variant, theme: Theme): MockRefs {
  const rows = ROWS[variant];
  const mine = rows.filter((r) => r.who === 'me').map((r) => r.title);
  const total = rows.length;
  const claimed = rows.filter((r) => r.who !== 'open' && r.who !== 'free').length;
  const phone = document.createElement('div');
  phone.className = 'mbx-phone';
  phone.dataset['theme'] = theme;
  phone.innerHTML = `<div class="mbx-screen">
    <div class="mbx-bar"><span class="mbx-pill">‹ Zurück</span><b>Annas Einweihung</b><span class="mbx-pill round">···</span></div>
    <div class="mbx-content">
      <div class="mbx-seg"><span>Wünsche</span><span class="on">Mitbringen</span></div>
      <section class="mbx-section">
        <div><h2 class="mbx-h2">Mitbringen</h2>
          <span class="mbx-progress"><span data-k="prog-old">${claimed} von ${total} verteilt</span><span class="new" data-k="prog-new" style="opacity:0">${claimed + 1} von ${total} verteilt</span></span></div>
        <p class="mbx-public">Hier sieht jeder, wer was mitbringt – auch Anna.</p>
        <p class="mbx-you"><span class="mbx-hl" data-k="hl"></span><span class="txt">Du bringst: ${mine.join(', ')}<span data-k="you-new" style="opacity:0">, Kuchen</span></span></p>
        <div class="mbx-card" data-k="card"><ul>${rows.map(rowMarkup).join('')}</ul></div>
        <p class="mbx-done" data-k="done" style="opacity:0">Alles ist verteilt. Danke!</p>
        <span class="mbx-add"><i>+</i>Ich bringe … mit</span>
      </section>
    </div>
  </div>
  <div class="mbx-layer" data-k="layer"></div>`;
  const q = <T extends Element = HTMLElement>(key: string): T => {
    const el = phone.querySelector<T & Element>(`[data-k="${key}"]`);
    if (!el) throw new Error(`[mitbringen] mock part missing: ${key}`);
    return el;
  };
  const claim = phone.querySelector<HTMLElement>('[data-claim]');
  const you = phone.querySelector<HTMLElement>('.mbx-you');
  const screen = phone.querySelector<HTMLElement>('.mbx-screen');
  if (!claim || !you || !screen) throw new Error('[mitbringen] mock failed to build');
  // the highlight hugs the whole line (text + the new word)
  return { phone, screen, card: q('card'), claim, you, youNew: q('you-new'), hl: q('hl'), layer: q('layer'), q };
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface MockGeometry {
  W: number;
  H: number;
  card: Box;
  claim: Box;
  you: Box;
  youNew: Box;
}

/**
 * Boxes of the parts in phone px (call while the phone is in the document and NOT scaled). Without layout (jsdom) it
 * falls back to the nominal layout of MOCK_CSS, so the shows can still be authored and tested.
 */
export function measure(refs: MockRefs): MockGeometry {
  const p = refs.phone.getBoundingClientRect();
  const rel = (el: Element): Box => {
    const r = el.getBoundingClientRect();
    return { left: r.left - p.left, top: r.top - p.top, width: r.width, height: r.height };
  };
  if (p.width > 0) {
    // the line's highlight hugs its text (the <p> itself is as wide as the column)
    const txt = refs.you.querySelector('.txt');
    const you = txt ? rel(txt) : rel(refs.you);
    refs.hl.style.width = `${you.width + 16}px`;
    return { W: p.width, H: p.height, card: rel(refs.card), claim: rel(refs.claim), you, youNew: rel(refs.youNew) };
  }
  const card = { left: 16, top: 312, width: 358, height: 360 };
  return {
    W: 390,
    H: 780,
    card,
    claim: { left: 16, top: card.top + 72, width: 358, height: 72 },
    you: { left: 16, top: card.top - 32, width: 238, height: 20 },
    youNew: { left: 196, top: card.top - 32, width: 58, height: 20 },
  };
}

export interface UiBeats {
  /** timeline second when the new item shows up in "Du bringst" */
  word: number;
  /** the line's highlight (with the basket): on, off */
  glow: [number, number] | null;
  /** timeline second when "Alles ist verteilt. Danke!" shows (the last free item only) */
  done: number | null;
}

/**
 * The app's own reaction on the timeline (T = PRE + moment seconds). Only transform and opacity.
 * Tap (button scale .97, snappy) → spinner while the server answers → at PRE the row becomes "Du · Doch nicht" (the
 * title slides to the middle, the subtitle fades), the counter changes; "Alles ist verteilt. Danke!" for the last item.
 */
export function uiTracks(refs: MockRefs, beats: UiBeats): Track[] {
  const q = refs.q;
  const tracks: Track[] = [];
  const T0 = PRE;
  // the tap and the wait (Button: scale .97 on press, the spinner keeps the width)
  const btn = new Track(q('btn'), 'ui.btn', { s: 1, o: 1 });
  btn.path(0.06, [[0.14, { s: 0.97 }, E.out], [0.32, { s: 1 }, E.spring]]);
  const lbl = new Track(q('lbl'), 'ui.lbl', { o: 1 });
  lbl.move(0.16, 0.24, { o: 0 }, 'linear');
  const spinO = new Track(q('spin'), 'ui.spin.o', { o: 0 });
  spinO.move(0.16, 0.24, { o: 1 }, 'linear');
  const spinR = new Track(q('spin'), 'ui.spin.r', { r: 0 });
  spinR.move(0.16, T0 + 0.16, { r: 360 * ((T0 + 0.16 - 0.16) / 0.75) }, 'linear');
  // the answer: the button fades out, "Du · Doch nicht" fades in in its place
  btn.move(T0, T0 + 0.16, { o: 0 }, 'ease-out');
  spinO.move(Math.max(T0, spinO.end), T0 + 0.16, { o: 0 }, 'ease-out');
  const mine = new Track(q('mine-new'), 'ui.mine', { o: 0 });
  mine.move(T0 + 0.06, T0 + 0.26, { o: 1 }, 'ease-out');
  // the row loses its subtitle ("Noch offen"); the title slides to the middle of the row (no reflow)
  const sub = new Track(q('sub'), 'ui.sub', { o: 1 });
  sub.move(T0, T0 + 0.14, { o: 0 }, 'ease-out');
  const title = new Track(q('title'), 'ui.title', { y: 0 });
  title.move(T0 + 0.02, T0 + 0.3, { y: 11 }, 'cubic-bezier(.2,.7,.3,1)');
  // the counter
  const progOld = new Track(q('prog-old'), 'ui.prog.old', { o: 1 });
  const progNew = new Track(q('prog-new'), 'ui.prog.new', { o: 0 });
  progOld.move(T0, T0 + 0.16, { o: 0 }, 'ease-out');
  progNew.move(T0 + 0.06, T0 + 0.24, { o: 1 }, 'ease-out');
  // the new item in "Du bringst" (0.35 s fade — the reduced-motion version is exactly this)
  const word = new Track(refs.youNew, 'ui.word', { o: 0 });
  word.move(beats.word, beats.word + 0.35, { o: 1 }, 'ease-out');
  tracks.push(btn, lbl, spinO, spinR, mine, sub, title, progOld, progNew, word);
  if (beats.glow) {
    const hl = new Track(refs.hl, 'ui.highlight', { o: 0 });
    hl.move(beats.glow[0], beats.glow[0] + 0.18, { o: 1 }, 'ease-out');
    hl.move(beats.glow[1], beats.glow[1] + 0.45, { o: 0 }, 'ease-in-out');
    tracks.push(hl);
  }
  if (beats.done !== null) {
    // a soft fade in place (the line is laid out from the start, nothing reflows)
    const done = new Track(q('done'), 'ui.done', { o: 0 });
    done.move(beats.done, beats.done + 0.35, { o: 1 }, 'ease-out');
    tracks.push(done);
  }
  return tracks;
}
