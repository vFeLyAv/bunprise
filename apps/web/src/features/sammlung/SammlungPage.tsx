import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from 'react'
import { useCanGoBack, useNavigate, useRouter } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import type { Bunny } from '@bunprise/mascot'
import { OUTFITS, dayMonth, isCostumeId, seasonOutfit, unlocked, wearNow, type CostumeId, type OutfitId, type WearId } from '@bunprise/mascot/wardrobe-rules'
import { DEMO_MODE } from '../../lib/app'
import { currentLanguage } from '../../lib/i18n'
import { onThemeChange } from '../../lib/theme'
import { Button, LargeTitle, Page, Segmented, Switch, TopBar, haptic, useBunniesShown } from '../../ui'
import { Sheet } from '../../ui/Sheet'
import { usePageTitle } from '../auth/shared'
import { useMascotMotion } from '../mascot-ui/mascotMotion'
import { registerMascot, releaseStage, requestStage, unregisterMascot } from '../mascot-ui/stage'
import { knightFinds, MILESTONES, SCENES_FOR_KNIGHT } from './milestones'
import { costumesOf, countedScenes, demoUnlockAll, markCostumeSeen, markSeen, newCostumes, readSammlung, setWear, useSammlung, wearTheme } from './store'
import { SCENES, scene, type SceneCard, type SceneId } from './scenes'
import type { Show } from './shows'
import './sammlung.css'

// «Pompons Sammlung» (design docs/design/2026-10-27-pompons-sammlung.md §2, Felix's decisions §0; the gallery page
// demo/sammlung/gallery.ts). Profil → «Pompons Sammlung» → two tabs:
//   Szenen    — every hidden scene as a card: found = a frozen frame of the real scene, its name and where it lives
//               (a tap replays it in a sheet: «Nochmal», «Schließen»); not found = a pale silhouette, «Noch geheim»
//               and a spoiler-free hint. «4 von 9 gefunden» — never the names of the unfound ones.
//   Garderobe — Pompon in today's outfit, «Nach Jahreszeit», the six outfits (B: the season's for everyone, each find
//               unlocks one for the whole year), the twelve costumes (31.10: each one for one of the person's own
//               milestones, ./milestones.ts), «Nichts anziehen».
// Only this device (store.ts); opening the page clears the dot at the Profil row. A new costume: the page opens on the
// Garderobe, its tile «opens» once (the pale cover fades, he grows in softly) and one quiet line names it — no pop-up.
// "Kaninchen zeigen" off: no collection (the row is gone too); the finds stay. «Weniger»: the calm version of every
// scene, no drop, no hop, the laptop's still typing pose. One mascot at a time: a replay or the typing holds the stage
// (mascot-ui/stage.ts); the posters are frozen.

type Tab = 'scenes' | 'wardrobe'
type WardrobeModule = typeof import('@bunprise/mascot/wardrobe')
let wardrobeModule: Promise<WardrobeModule> | null = null
function loadWardrobe(): Promise<WardrobeModule> {
  wardrobeModule ??= import('@bunprise/mascot/wardrobe').catch((err: unknown) => {
    wardrobeModule = null
    throw err
  })
  return wardrobeModule
}

function systemReduced(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

function useWearTheme(): 'light' | 'dark' | 'navy' {
  return useSyncExternalStore(onThemeChange, wearTheme, () => 'light')
}

function useBack(): () => void {
  const router = useRouter()
  const canGoBack = useCanGoBack()
  const navigate = useNavigate()
  return () => {
    if (canGoBack) router.history.back()
    else void navigate({ to: '/settings' })
  }
}

export function SammlungPage({ userId }: { userId: string }) {
  const { t } = useTranslation('settings')
  const back = useBack()
  const shown = useBunniesShown()
  const rec = useSammlung(userId)
  // a new costume waits for its moment: the page opens where it is
  const [tab, setTab] = useState<Tab>(() => (newCostumes(readSammlung(userId)).length ? 'wardrobe' : 'scenes'))
  const theme = useWearTheme()
  const title = t('sammlung.title')
  usePageTitle(title)
  // the person looks at the collection: the dot at the Profil row goes away (also for finds made while here)
  useEffect(() => {
    if (shown) markSeen(userId)
  }, [userId, shown, rec.found.length])

  return <Page topBar={<TopBar large title={title} back={{ label: t('settings.title'), onClick: back }} />}>
    <div className="sam-page flex flex-col gap-5 pt-4" data-dark={theme === 'light' ? undefined : ''}>
      <LargeTitle className="mb-0">{title}</LargeTitle>
      {!shown ? <p className="sam-off t-body text-text-2">{t('sammlung.off')}</p> : <>
        <Segmented label={title} value={tab} onChange={setTab}
          options={[{ value: 'scenes', label: t('sammlung.tab_scenes') }, { value: 'wardrobe', label: t('sammlung.tab_wardrobe') }]} />
        {tab === 'scenes' ? <ScenesTab found={rec.found} /> : <WardrobeTab userId={userId} theme={theme} />}
        <p className="sam-foot t-footnote text-text-3">{t('sammlung.device')}</p>
      </>}
    </div>
  </Page>
}

// ---- Szenen ---------------------------------------------------------------------------------------------------

/** A scene's natural box, scaled down into a thumbnail / the sheet's stage (bottom-centred; «Fester Boden» 1:1). */
function natStyle(card: SceneCard, w: number, h: number, zoom = true): { width: number; height: number; scale: number } {
  if (card.id === 'footing') return { width: w, height: h, scale: 1 }
  const scale = Math.min(w / card.box.w, h / card.box.h) * (zoom ? card.zoom ?? 1 : 1)
  return { width: card.box.w, height: card.box.h, scale }
}

/** The scene in `nat` once its box is laid out (`ready`: the box exists and has its final size). */
function useShow(id: SceneId, nat: RefObject<HTMLDivElement | null>, reduced: boolean, ready: boolean): RefObject<Show | null> {
  const show = useRef<Show | null>(null)
  useEffect(() => {
    const box = nat.current
    if (!box || !ready) return
    let alive = true
    import('./shows').then((m) => m.mountShow(id, box, reduced)).then((s) => {
      if (!alive) { s.destroy(); return }
      show.current = s
      s.poster()
    }, () => undefined)
    return () => {
      alive = false
      show.current?.destroy()
      show.current = null
    }
  }, [id, nat, reduced, ready])
  return show
}

function SceneThumb({ card, found, reduced }: { card: SceneCard; found: boolean; reduced: boolean }) {
  const thumb = useRef<HTMLDivElement>(null)
  const nat = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(0)
  useEffect(() => setW(thumb.current?.clientWidth || 160), [])
  const s = natStyle(card, w || 160, 108)
  useShow(card.id, nat, reduced, w > 0)
  return <div ref={thumb} className="sam-thumb" aria-hidden="true">
    <div className={found ? 'sam-layer' : 'sam-layer sil'}>
      {w ? <div ref={nat} className="sam-nat" style={{ width: s.width, height: s.height, marginLeft: -s.width / 2, transform: s.scale === 1 ? undefined : `scale(${s.scale})` }} /> : null}
    </div>
    {!found ? <span className="sam-q">?</span> : null}
  </div>
}

function ScenesTab({ found }: { found: readonly SceneId[] }) {
  const { t } = useTranslation('settings')
  const { reducedMotion } = useMascotMotion()
  const reduced = reducedMotion === 'force' || (reducedMotion === 'auto' && systemReduced())
  const counted = countedScenes(found)
  const n = found.filter((id) => counted.includes(id)).length
  const [open, setOpen] = useState<SceneId | null>(null)
  return <>
    <div className="sam-sum">
      <b className="t-title-3 text-text">{t('sammlung.count', { n, m: counted.length })}</b>
      <span className="sam-dots" aria-hidden="true">{counted.map((id) => <i key={id} className={found.includes(id) ? 'on' : undefined} />)}</span>
    </div>
    <p className="t-footnote text-text-2 -mt-3">{t('sammlung.tap_hint')}</p>
    <ul className="sam-grid">
      {SCENES.map((card) => {
        const isFound = found.includes(card.id)
        const name = t(`sammlung.scene.${card.id}.title`)
        const hint = t(`sammlung.scene.${card.id}.hint`)
        const body = <>
          <SceneThumb card={card} found={isFound} reduced={reduced} />
          <span className="sam-text">
            {isFound
              ? <><b className="t-subhead text-text">{name}</b><span className="t-caption-1 text-text-2">{t(`sammlung.scene.${card.id}.where`)}</span></>
              : <><b className="t-subhead text-text">{t('sammlung.secret')}</b><span className="t-caption-1 text-text-2">{hint}</span>
                {card.iphoneOnly ? <em className="t-caption-2 text-text-3">{t('sammlung.only_iphone')}</em> : null}</>}
          </span>
        </>
        return <li key={card.id}>
          {isFound
            ? <button type="button" className="sam-card glass-panel" data-scene={card.id} aria-label={t('sammlung.found_label', { name })}
                onPointerDown={() => haptic('tap')} onClick={() => setOpen(card.id)}>{body}</button>
            : <div className="sam-card glass-panel locked" data-scene={card.id} role="img" aria-label={t('sammlung.locked_label', { hint })}>{body}</div>}
        </li>
      })}
    </ul>
    <ReplaySheet id={open} reduced={reduced} onClose={() => setOpen(null)} />
  </>
}

function ReplaySheet({ id, reduced, onClose }: { id: SceneId | null; reduced: boolean; onClose: () => void }) {
  const { t } = useTranslation('settings')
  // keep the last scene while the sheet slides away
  const [shownId, setShownId] = useState<SceneId | null>(id)
  if (id && id !== shownId) setShownId(id)
  const card = shownId ? scene(shownId) : null
  const [again, setAgain] = useState(0)
  return <Sheet open={id !== null} onClose={onClose} closeLabel={t('sammlung.close')} title={card ? t(`sammlung.scene.${card.id}.title`) : undefined}
    footer={card && id ? <ReplayButtons onAgain={() => setAgain((a) => a + 1)} onClose={onClose} /> : null}>
    {card ? <div className="flex flex-col gap-3 pb-2">
      <p className="t-footnote text-text-2">{t(`sammlung.scene.${card.id}.where`)}{reduced ? ` · ${t('sammlung.calm')}` : ''}</p>
      {id ? <ReplayStage key={card.id} card={card} reduced={reduced} again={again} /> : <div className="sam-stage" />}
    </div> : null}
  </Sheet>
}

function ReplayButtons({ onAgain, onClose }: { onAgain: () => void; onClose: () => void }) {
  const { t } = useTranslation('settings')
  return <div className="flex gap-3">
    <Button variant="secondary" size="lg" fullWidth onClick={onClose}>{t('sammlung.close')}</Button>
    <Button size="lg" fullWidth onClick={onAgain}>{t('sammlung.again')}</Button>
  </div>
}

function ReplayStage({ card, reduced, again }: { card: SceneCard; reduced: boolean; again: number }) {
  const stage = useRef<HTMLDivElement>(null)
  const nat = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(0)
  useEffect(() => setW(stage.current?.clientWidth || 340), [])
  const s = natStyle(card, w || 340, 230, false)
  const show = useShow(card.id, nat, reduced, w > 0)
  const playRef = useRef<() => void>(() => undefined)
  useEffect(() => {
    if (!w) return
    const id = Symbol('sammlung-replay')
    let busy = false
    let destroyed = false
    // one mascot at a time: the replay is a 'response' (the person asked for it); a more important moment freezes it
    registerMascot(id, { get busy() { return busy }, get isDestroyed() { return destroyed }, stopIdle: () => undefined, startIdle: () => undefined, interrupt: () => { show.current?.poster(); busy = false } }, false)
    const play = () => {
      const sh = show.current
      if (!sh || destroyed || !requestStage(id, 'response')) return
      busy = true
      void sh.play().then(() => { busy = false; releaseStage(id) })
    }
    playRef.current = play
    // once the sheet is up; the scene's chunk may still be on its way: try for a few frames
    let tries = 0
    const first = window.setInterval(() => {
      if (show.current || ++tries > 40) { window.clearInterval(first); play() }
    }, 60)
    return () => {
      destroyed = true
      playRef.current = () => undefined
      window.clearInterval(first)
      unregisterMascot(id)
    }
  }, [w, card.id, show])
  // «Nochmal»
  const seenAgain = useRef(again)
  useEffect(() => {
    if (again === seenAgain.current) return
    seenAgain.current = again
    playRef.current()
  }, [again])
  return <div ref={stage} className="sam-stage" aria-hidden="true">
    {w ? <div ref={nat} className="sam-nat" style={{ width: s.width, height: s.height, marginLeft: -s.width / 2, transform: s.scale === 1 ? undefined : `scale(${s.scale})` }} /> : null}
  </div>
}

// ---- Garderobe ------------------------------------------------------------------------------------------------

type Typing = InstanceType<WardrobeModule['LaptopTyping']>

/**
 * The laptop's typing in the shop window (the package's LaptopTyping, 4.9 s, finite): a 'response' moment of its own on
 * the stage (one mascot at a time — his idle stops meanwhile). «Weniger»: the still typing pose, no stage needed.
 */
function startTyping(w: WardrobeModule, b: Bunny, calm: boolean): () => void {
  const id = Symbol('sammlung-typing')
  let run: Typing | null = null
  let done = false
  const stop = () => {
    if (done) return
    done = true
    run?.destroy()
    run = null
    unregisterMascot(id)
  }
  if (calm) {
    run = new w.LaptopTyping(b.root, b.host, true)
    return () => { run?.destroy(); run = null }
  }
  registerMascot(id, { get busy() { return !done }, get isDestroyed() { return done || b.isDestroyed }, stopIdle: () => undefined, startIdle: () => undefined, interrupt: stop }, false)
  if (!requestStage(id, 'response')) {
    stop()
    return stop
  }
  run = new w.LaptopTyping(b.root, b.host, false, () => { releaseStage(id); stop() })
  run.play()
  return stop
}

/** Pompon in one outfit or costume (the package puppet, dressed by @bunprise/mascot/wardrobe). `live` = the shop window. */
function OutfitPuppet({ outfit, size, theme, live, drop = 0, className, onDrawn }: { outfit: WearId | null; size: number; theme: 'light' | 'dark' | 'navy'; live: boolean; drop?: number; className?: string; onDrawn?: () => void }) {
  const host = useRef<HTMLDivElement>(null)
  const inst = useRef<Bunny | null>(null)
  const kit = useRef<WardrobeModule | null>(null)
  const [ready, setReady] = useState(false)
  const { reducedMotion } = useMascotMotion()
  const motion = useRef(reducedMotion)
  const dropped = useRef(drop)
  const typing = useRef<(() => void) | null>(null)
  const drawn = useRef(onDrawn)
  useEffect(() => {
    drawn.current = onDrawn
  })
  useEffect(() => {
    let alive = true
    const id = Symbol('sammlung-pompon')
    const calm = !live || motion.current === 'force'
    // the package with Pompon's look, through the Mascot wrapper's loader (a lazy import: this page's own preload list stays short)
    Promise.all([import('../mascot-ui/Mascot').then((m) => m.loadMascotModule()), loadWardrobe()]).then(([mod, w]) => {
      const el = host.current
      if (!alive || !el) return
      const b = new mod.Bunny(el, { size, idle: !calm, interactive: false, reducedMotion: live ? motion.current : 'force', coat: 'fawn', ears: 'lop' })
      inst.current = b
      kit.current = w
      if (live) registerMascot(id, b, !calm)
      setReady(true)
    }, () => undefined)
    return () => {
      alive = false
      typing.current?.()
      typing.current = null
      if (live) unregisterMascot(id)
      inst.current?.destroy()
      inst.current = null
      setReady(false)
    }
  }, [live, size])
  useEffect(() => {
    const b = inst.current
    const w = kit.current
    if (!ready || !b || !w) return
    // the typing writes on his own parts: it ends (and gives them back) before he changes
    typing.current?.()
    typing.current = null
    const g = w.dress(b.root, b.host, outfit, theme)
    drawn.current?.()
    // a fresh choice of the person: the outfit drops in, then he does his one approved hop (none under «Weniger»);
    // the laptop: then he types — Enter, and a heart pops out of the screen (under «Weniger»: the still typing pose)
    if (drop !== dropped.current) {
      dropped.current = drop
      const calm = motion.current === 'force' || (motion.current === 'auto' && systemReduced())
      const laptop = live && outfit === 'laptop'
      if (laptop && calm) typing.current = startTyping(w, b, true)
      const a = live && !calm ? w.dropIn(g, false) : null
      void a?.finished.then(async () => {
        if (b.isDestroyed) return
        await b.hop()
        // still this very choice (not a newer one meanwhile)
        if (laptop && !b.isDestroyed && dropped.current === drop && w.wearing(b.root) === 'laptop') {
          typing.current?.()
          typing.current = startTyping(w, b, false)
        }
      }).catch(() => undefined)
    }
  }, [ready, outfit, theme, drop, live])
  return <div ref={host} className={className} aria-hidden="true" />
}

function formatToday(date: Date): string {
  try {
    return new Intl.DateTimeFormat(currentLanguage(), { day: 'numeric', month: 'long' }).format(date)
  } catch {
    return `${date.getDate()}.${date.getMonth() + 1}.`
  }
}

/**
 * One costume tile. A NEW one (`fresh`) waits under a pale cover until it is really on screen and Pompon is drawn in
 * it, then «opens» once (sammlung.css: the cover fades, he grows in softly — opacity / transform only; «Weniger»:
 * simply there) and tells the store it was seen (the dot at the Profil row goes when all are).
 */
function CostumeTile({ id, isOpen, isWorn, how, theme, fresh, onRevealed, onChoose }: {
  id: CostumeId; isOpen: boolean; isWorn: boolean; how: string; theme: 'light' | 'dark' | 'navy'; fresh: boolean
  onRevealed: () => void; onChoose: () => void
}) {
  const { t } = useTranslation('settings')
  const tile = useRef<HTMLButtonElement>(null)
  const [onScreen, setOnScreen] = useState(() => typeof IntersectionObserver !== 'function')
  const [drawn, setDrawn] = useState(false)
  useEffect(() => {
    const el = tile.current
    if (!fresh || onScreen || !el || typeof IntersectionObserver !== 'function') return
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setOnScreen(true)
    }, { threshold: 0.6 })
    io.observe(el)
    return () => io.disconnect()
  }, [fresh, onScreen])
  const revealing = fresh && onScreen && drawn
  const revealed = useRef(onRevealed)
  useEffect(() => {
    revealed.current = onRevealed
  })
  useEffect(() => {
    if (revealing) revealed.current()
  }, [revealing])
  const state = isWorn ? t('sammlung.worn') : isOpen ? t('sammlung.free') : how
  return <button ref={tile} type="button" className={`sam-tile glass-panel${isOpen ? '' : ' locked'}${isWorn ? ' on' : ''}`} aria-pressed={isWorn} data-costume={id}
    data-fresh={fresh && !revealing ? '' : undefined} data-reveal={revealing ? '' : undefined}
    aria-label={`${t(`sammlung.costume.${id}`)} · ${state}`}
    onPointerDown={() => haptic('tap')} onClick={onChoose}>
    <span className="sam-mini"><OutfitPuppet className="sam-mini-host" outfit={id} size={150} theme={theme} live={false} onDrawn={() => setDrawn(true)} /></span>
    <b className="t-caption-1 text-text">{t(`sammlung.costume.${id}`)}</b>
    <span className="t-caption-2 text-text-2">{state}</span>
  </button>
}

function WardrobeTab({ userId, theme }: { userId: string; theme: 'light' | 'dark' | 'navy' }) {
  const { t } = useTranslation('settings')
  const rec = useSammlung(userId)
  const [today] = useState(() => new Date())
  const date = dayMonth(today)
  const n = rec.found.length
  const costumes = costumesOf(rec)
  const worn = wearNow(rec.wear, date, n, costumes)
  const open = unlocked(n)
  const inSeason = seasonOutfit(date)
  const [drop, setDrop] = useState(0)
  const [note, setNote] = useState<ReactNode>(null)
  const [costumeNote, setCostumeNote] = useState<ReactNode>(null)
  // the new costumes of this visit: each tile «opens» once it is on screen; then that one is not new any more
  const [fresh, setFresh] = useState<readonly CostumeId[]>(() => newCostumes(rec))
  // (also a costume earned while the page is open, or the demo button: its moment too)
  const missing = newCostumes(rec).filter((id) => !fresh.includes(id))
  if (missing.length) setFresh([...fresh, ...missing])
  const choose = (wear: typeof rec.wear) => {
    setNote(null)
    setCostumeNote(null)
    setWear(userId, wear)
    setDrop((d) => d + 1)
  }
  const wearName = (id: WearId) => (isCostumeId(id) ? t(`sammlung.costume.${id}`) : t(`sammlung.outfit.${id as OutfitId}`))
  const freshNames = fresh.map((id) => t(`sammlung.costume.${id}`)).join(', ')
  return <>
    <div className="sam-dressing glass-panel">
      <p className="sam-cap t-footnote text-text-2" aria-live="polite">
        {t('sammlung.today', { date: formatToday(today) })} <b className="text-text">{worn ? wearName(worn) : t('sammlung.wears_nothing')}</b>
      </p>
      <div className="sam-floor glass-panel" />
      <OutfitPuppet className="sam-pompon" outfit={worn} size={240} theme={theme} live drop={drop} />
    </div>
    <div className="glass-panel sam-switch-row">
      <Switch checked={rec.wear === 'auto'} label={t('sammlung.season')} description={t('sammlung.season_sub')}
        onChange={(on) => choose(on ? 'auto' : 'none')} />
    </div>
    <ul className="sam-outfits">
      {OUTFITS.map((o, i) => {
        const isOpen = open.includes(o.id)
        const isWorn = worn === o.id
        const need = i + 1 - n
        const state = isWorn ? (isOpen ? t('sammlung.worn') : `${t('sammlung.worn')} · ${t('sammlung.in_season')}`)
          : isOpen ? t('sammlung.free') : inSeason === o.id ? t('sammlung.in_season') : t('sammlung.more', { count: need })
        return <li key={o.id}>
          <button type="button" className={`sam-tile glass-panel${isOpen || isWorn ? '' : ' locked'}${isWorn ? ' on' : ''}`} aria-pressed={isWorn} data-outfit={o.id}
            aria-label={`${wearName(o.id)} · ${t(`sammlung.when.${o.id}`)} · ${state}`}
            onPointerDown={() => haptic('tap')}
            onClick={() => (isOpen ? choose(o.id) : setNote(t('sammlung.locked', { count: need })))}>
            <span className="sam-mini"><OutfitPuppet className="sam-mini-host" outfit={o.id} size={150} theme={theme} live={false} /></span>
            <b className="t-caption-1 text-text">{wearName(o.id)}</b>
            <span className="t-caption-2 text-text-2">{t(`sammlung.when.${o.id}`)} · {state}</span>
          </button>
        </li>
      })}
    </ul>
    <p className="sam-note t-footnote text-text-2" aria-live="polite">{note ?? t('sammlung.earn')}</p>
    <h2 className="sam-h t-title-3 text-text">{t('sammlung.costumes_title')}</h2>
    <ul className="sam-outfits" data-costumes="">
      {MILESTONES.map((m) => {
        const id = m.costume
        const isOpen = costumes.includes(id)
        const knightLeft = SCENES_FOR_KNIGHT - knightFinds(rec.found)
        const how = m.id === 'scenes' ? t('sammlung.more', { count: knightLeft }) : t(`sammlung.milestone.${m.id}.short`)
        return <li key={id}>
          <CostumeTile id={id} isOpen={isOpen} isWorn={worn === id} how={how} theme={theme} fresh={fresh.includes(id)}
            onRevealed={() => markCostumeSeen(userId, id)}
            onChoose={() => (isOpen ? choose(id) : setCostumeNote(m.id === 'scenes'
              ? t('sammlung.locked', { count: knightLeft })
              : t('sammlung.costume_locked', { how: t(`sammlung.milestone.${m.id}.how`) })))} />
        </li>
      })}
    </ul>
    <p className="sam-note t-footnote text-text-2" aria-live="polite">
      {costumeNote ?? (fresh.length ? t('sammlung.costume_new', { names: freshNames, count: fresh.length }) : t('sammlung.costumes_earn'))}
    </p>
    <Button variant="secondary" size="lg" fullWidth aria-pressed={rec.wear === 'none'} onClick={() => choose('none')}>{t('sammlung.nothing')}</Button>
    {DEMO_MODE ? <Button variant="secondary" size="lg" fullWidth data-demo-unlock="" onClick={() => demoUnlockAll(userId)}>{t('sammlung.demo_unlock')}</Button> : null}
  </>
}
