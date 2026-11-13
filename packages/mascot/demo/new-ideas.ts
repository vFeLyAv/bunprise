import { CarryStage, ChaseStage, HamsterEdgeStage, NibbleStage, OverfedStage, WelcomeStage, COATS, type BunnyCoat, type ReducedMotionMode, type WelcomePreset } from '../src/index';
import { OVERFED_DEFAULT, OVERFED_TITLES, OVERFED_VARIANTS, type OverfedVariant } from '../src/overfed';

type Stage = CarryStage | ChaseStage | HamsterEdgeStage | NibbleStage | OverfedStage | WelcomeStage;
const PRESETS: readonly WelcomePreset[] = ['corner-left', 'corner-right', 'lift', 'meet', 'ears-only', 'surprise', 'peek-sniff', 'hop-across'];
const TITLES: Record<string, string> = { 'corner-left': 'Из-за левого угла', 'corner-right': 'Из-за правого угла', lift: 'Лифт', meet: 'Двое из-за косяков', 'ears-only': 'Только уши', surprise: 'Уши торчком', 'peek-sniff': 'Помпон нюхает', 'hop-across': 'Кроличий галоп', chase: 'Погоня за сельдереем', nibble: 'Откусил кусочек', hamster: 'Тапси из-за края', letter: 'Письмо', 'jump-out': 'Прыжок из +', calendar: 'Календарик',
  // «Переел» (23.10): three variants side by side, Felix picks one — each in the app's own slot (card width × 150 px)
  ...Object.fromEntries(OVERFED_VARIANTS.map((v) => [`overfed-${v}`, `Переел — вариант ${v.toUpperCase()}: ${OVERFED_TITLES[v]}`])) };
const overfedOf = (name: string): OverfedVariant | null => (name.startsWith('overfed-') ? (name.slice(8) as OverfedVariant) : null);
const names = Object.keys(TITLES);

export function newIdeasGallery(app: HTMLElement): void {
  const query = new URLSearchParams(location.search);
  const asked = query.get('move');
  // ?move=overfed (the old single tile) = the recommended variant
  const only = asked === 'overfed' ? `overfed-${OVERFED_DEFAULT}` : asked;
  if (only) app.replaceChildren();
  const section = document.createElement('section');
  section.style.cssText = 'max-width:1000px;margin:36px auto;padding:16px';
  section.innerHTML = '<h2>Новые идеи Кирилла</h2><p>Каждый показ можно остановить. Выберите окрас и режим движения.</p>';
  const controls = document.createElement('div');
  controls.style.cssText = 'display:flex;gap:12px;flex-wrap:wrap;margin:12px 0';
  const coat = document.createElement('select');
  coat.setAttribute('aria-label', 'Окрас');
  for (const c of COATS.bunny) coat.add(new Option(c.name, c.id));
  coat.value = query.get('coat') ?? 'fawn';
  const motion = document.createElement('select');
  motion.setAttribute('aria-label', 'Движение');
  motion.add(new Option('Полное движение', 'off')); motion.add(new Option('Уменьшенное движение', 'force'));
  motion.value = query.get('reduced') === '1' ? 'force' : 'off';
  controls.append(coat, motion); section.append(controls);
  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:18px';
  section.append(grid);app.append(section);
  let active: Stage | null = null;
  const stages: Stage[] = [];
  for (const name of only && names.includes(only) ? [only] : names) {
    const card = document.createElement('article');
    card.style.cssText = 'border:1px solid #DECAB0;background:#FFF9F0;border-radius:22px;padding:12px;overflow:hidden';
    const title = document.createElement('h3');title.textContent = TITLES[name] ?? name;card.append(title);
    const host = document.createElement('div');
    host.dataset['ideaStage'] = name;
    host.style.cssText = 'height:210px;position:relative;overflow:hidden;background:#FFF9F0;border-radius:16px';
    if (overfedOf(name)) {
      // as in the app: the deck card's picture slot (full card width × 150 px) and the paper tokens (contour, shadow);
      // ?w=358&h=150 sets the slot for frame checks (390 / 320 px phones = 358 / 288 px cards)
      host.style.height = `${Number(query.get('h')) || 150}px`;
      if (only === name && query.has('w')) host.style.width = `${Number(query.get('w'))}px`;
      host.style.setProperty('--mascot-outline', 'rgba(224,171,116,.5)');
      host.style.setProperty('--mascot-shadow', 'rgba(70,40,15,.20)');
    }
    card.append(host);
    const buttons = document.createElement('div');buttons.style.cssText = 'display:flex;gap:8px;margin-top:8px';
    const play = document.createElement('button');play.textContent = 'Показать';play.style.minHeight = '44px';
    const stop = document.createElement('button');stop.textContent = 'Остановить';stop.style.minHeight = '44px';
    buttons.append(play, stop);card.append(buttons);grid.append(card);
    let stage: Stage | null = null;
    const build = () => {
      active?.destroy();stage?.destroy();host.replaceChildren();
      const options = { coat: coat.value as BunnyCoat, reducedMotion: motion.value as ReducedMotionMode };
      if (PRESETS.includes(name as WelcomePreset) || name === 'calendar') stage = new WelcomeStage(host, { bunnies: [options.coat, options.coat === 'choc' ? 'fawn' : 'choc'], choreography: name === 'calendar' ? 'peek-sniff' : name as WelcomePreset, reducedMotion: options.reducedMotion, minSize: 125, maxSize: 148, calmEyes: 'happy', ...(name === 'calendar' ? { item: 'calendar' } : {}) });
      else if (name === 'chase') stage = new ChaseStage(host, options);
      else if (overfedOf(name)) stage = new OverfedStage(host, { ...options, illustration: query.get('deco') !== '1', variant: overfedOf(name) ?? OVERFED_DEFAULT });
      else if (name === 'hamster') stage = new HamsterEdgeStage(host, { reducedMotion: options.reducedMotion, illustration: true, stay: true, edge: 'right', cheeks: 1.35 });
      else if (name === 'nibble') {
        const target = document.createElement('div');target.textContent = 'Карточка желания';target.style.cssText = 'position:absolute;left:50px;right:45px;top:115px;height:85px;background:#F5E5CE;border:1px solid #E0C5A4;border-radius:18px;padding:16px';host.append(target);
        const layer = document.createElement('div');layer.style.cssText = 'position:absolute;inset:0';host.append(layer);
        stage = new NibbleStage(layer, { ...options, target, background: '#FFF9F0' });
      } else stage = new CarryStage(host, { ...options, from: { left: 24, top: 145, width: 44, height: 44 }, to: { left: 180, top: 115, width: 80, height: 45 }, item: name === 'letter' ? 'letter' : 'none', ...(name === 'letter' ? { away: 'right' } : {}) });
      active = stage;stages.push(stage);
      return stage;
    };
    play.onclick = () => build().play();
    stop.onclick = () => { stage?.destroy(); };
    if (only === name) {
      const initial = build();
      if (query.has('t')) initial.seek(Number(query.get('t')) || 0); else initial.play();
      (window as unknown as { mascotReview: { seek(t: number): void; play(): void; duration: number } }).mascotReview = initial;
    }
  }
  window.addEventListener('pagehide', () => stages.forEach((stage) => stage.destroy()), { once: true });
}
