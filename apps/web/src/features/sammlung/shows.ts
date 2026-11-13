import { loadMascotModule } from '../mascot-ui/Mascot'
import { loadTower } from '../mascot-ui/TowerMoment'
import { scene, type SceneId } from './scenes'

// The collection's pictures and replays (design §2, the gallery's demo/sammlung/scenes.ts mountShow): each card shows
// a FROZEN frame of the package's own scene, the sheet plays it once more — TowerStage, HomeIconStage, ChaseStage,
// OverfedStage A/B/C, Tapsi's 'secret' and 'speck'. Nothing is redrawn here. The package is used directly, so a replay
// is never a find (features/sammlung/note.ts is not involved). Reduced motion = each scene's own calm version.
// «Fester Boden» is the Lists buddy's moment; the package has no public way to set him down at a card's end (the
// gallery reaches into his internals), so its card shows Pompon standing safely at a card's rounded end (^ ^) and the
// replay is his little hop there (docs/handoffs/2026-10-31-sammlung-in-app.md, open point).

export interface Show {
  /** the still frame of the card */
  poster(): void
  /** the scene once; resolves when this run is over (its natural end, or a later play() / destroy()) */
  play(): Promise<void>
  destroy(): void
}

type HomeIconModule = typeof import('@bunprise/mascot/homeicon')
let homeIcon: Promise<HomeIconModule> | null = null
function loadHomeIcon(): Promise<HomeIconModule> {
  homeIcon ??= Promise.all([import('@bunprise/mascot/homeicon'), import('../mascot-ui/pompon')]).then(([mod]) => mod).catch((err: unknown) => {
    homeIcon = null
    throw err
  })
  return homeIcon
}

function div(cls: string): HTMLDivElement {
  const d = document.createElement('div')
  d.className = cls
  return d
}

/** One run at a time: a new play() or destroy() ends the previous run's promise. */
function runs() {
  let end: (() => void) | null = null
  return {
    start(): { promise: Promise<void>; finish: () => void } {
      end?.()
      let finish!: () => void
      const promise = new Promise<void>((r) => (finish = r))
      end = finish
      return { promise, finish }
    },
    stop() {
      end?.()
      end = null
    },
  }
}

/**
 * Mounts scene `id` into `box` (in the document, sized to the scene's natural box — the caller scales it with a CSS
 * transform; «Fester Boden» is drawn at the box's own size). Resolves once the scene's chunk is there.
 */
export async function mountShow(id: SceneId, box: HTMLElement, reduced: boolean): Promise<Show> {
  const card = scene(id)
  const run = runs()
  const ledge = card.ledge === undefined ? null : div('sam-ledge glass-panel')
  if (ledge) ledge.style.top = `${card.ledge}px`
  const host = div('sam-scene-host')

  if (id === 'tower') {
    const mod = await loadTower()
    box.replaceChildren(...(ledge ? [ledge] : []), host)
    Object.assign(host.style, { left: '0', top: '0', width: `${card.box.w}px`, height: `${(card.ledge ?? 0) + 16}px` })
    let stage: InstanceType<typeof mod.TowerStage> | null = null
    const make = (onEnd?: () => void) => {
      stage?.destroy()
      stage = new mod.TowerStage(host, { reduced, card: { left: 16, width: card.box.w - 32, radius: 22 }, ...(onEnd ? { onEnd } : {}) })
      return stage
    }
    make()
    return {
      poster: () => { run.stop(); make().seek(reduced ? 1 : card.poster) },
      play: () => { const r = run.start(); make(r.finish).play(); return r.promise },
      destroy: () => { run.stop(); stage?.destroy() },
    }
  }

  if (id === 'homeicon') {
    const mod = await loadHomeIcon()
    box.replaceChildren(...(ledge ? [ledge] : []), host)
    Object.assign(host.style, { left: '0', top: '0', width: `${card.box.w}px`, height: `${card.box.h}px` })
    let stage: InstanceType<typeof mod.HomeIconStage> | null = null
    const make = (onEnd?: () => void) => {
      stage?.destroy()
      stage = new mod.HomeIconStage(host, { reducedMotion: reduced ? 'force' : 'off', still: false, label: 'Bunprise', ...(onEnd ? { onEnd } : {}) })
      return stage
    }
    return {
      poster: () => { run.stop(); const s = make(); s.seek(s.duration) },
      play: () => { const r = run.start(); make(r.finish).play(); return r.promise },
      destroy: () => { run.stop(); stage?.destroy() },
    }
  }

  const mod = await loadMascotModule()
  box.replaceChildren(...(ledge ? [ledge] : []), host)

  if (id === 'chase' || id === 'overfed-a' || id === 'overfed-b' || id === 'overfed-c') {
    const h = id === 'chase' ? 120 : card.box.h
    Object.assign(host.style, { left: '0', top: '0', width: `${card.box.w}px`, height: `${h}px` })
    let stage: InstanceType<typeof mod.ChaseStage> | InstanceType<typeof mod.OverfedStage> | null = null
    const make = () => {
      stage?.destroy()
      host.replaceChildren()
      const rm = reduced ? 'force' : 'off'
      stage = id === 'chase'
        ? new mod.ChaseStage(host, { reducedMotion: rm, coat: 'fawn' })
        : new mod.OverfedStage(host, { reducedMotion: rm, coat: 'fawn', illustration: true, variant: id.slice(8) as 'a' | 'b' | 'c' })
      return stage
    }
    return {
      poster: () => { run.stop(); const s = make(); s.seek(reduced ? s.duration : card.poster) },
      play: () => { const r = run.start(); const s = make(); void s.done.then(r.finish); s.play(); return r.promise },
      destroy: () => { run.stop(); stage?.destroy() },
    }
  }

  if (id === 'speck' || id === 'psst') {
    Object.assign(host.style, { left: `${(card.box.w - 150) / 2}px`, top: `${(card.ledge ?? 170) - 94}px`, width: '150px' })
    let m: InstanceType<typeof mod.Hamster> | null = null
    const make = () => {
      m?.destroy()
      host.replaceChildren()
      m = new mod.Hamster(host, { size: 150, idle: false, interactive: false, reducedMotion: reduced ? 'force' : 'off', coat: 'golden', ...(id === 'speck' ? { holding: 'binoculars' as const } : {}) })
      return m
    }
    return {
      poster: () => { run.stop(); const p = make(); if (id === 'psst') p.pose('psst') },
      play: () => { const r = run.start(); void make().play(id === 'psst' ? 'secret' : 'speck').finally(r.finish); return r.promise },
      destroy: () => { run.stop(); m?.destroy() },
    }
  }

  // «Fester Boden»: Pompon stands safely at a card's rounded end (^ ^), the replay is his hop there
  const W = box.clientWidth || card.box.w
  const H = box.clientHeight || card.box.h
  const small = H < 150
  const size = small ? 64 : 96
  const top = H - (small ? 30 : 56)
  const width = W - (small ? 0 : 20)
  Object.assign(host.style, { left: '0', top: '0', width: `${W}px`, height: `${H}px` })
  const cardEl = div('sam-buddy-card glass-panel')
  Object.assign(cardEl.style, { left: '-60px', top: `${top}px`, width: `${width}px`, height: '80px', borderRadius: `${small ? 18 : 24}px` })
  const pompon = div('sam-buddy')
  // his feet (the puppet's viewBox: feet at 246 of 260) on the card's top edge, a little inside its rounded end
  Object.assign(pompon.style, { left: `${width - 60 - size * 0.78}px`, top: `${top - size * (246 / 400)}px`, width: `${size}px` })
  host.append(cardEl, pompon)
  let b: InstanceType<typeof mod.Bunny> | null = null
  const make = (calm: boolean) => {
    b?.destroy()
    pompon.replaceChildren()
    b = new mod.Bunny(pompon, { size, idle: false, interactive: false, reducedMotion: calm || reduced ? 'force' : 'off', coat: 'fawn', ears: 'lop', calmEyes: 'happy' })
    return b
  }
  return {
    poster: () => { run.stop(); make(true) },
    play: () => {
      const r = run.start()
      const p = make(false)
      if (reduced) r.finish()
      else void p.hop().finally(() => { if (!p.isDestroyed) p.setReducedMotion('force'); r.finish() })
      return r.promise
    },
    destroy: () => { run.stop(); b?.destroy() },
  }
}
