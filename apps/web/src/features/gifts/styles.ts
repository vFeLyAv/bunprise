import { GIFT_STYLES, type GiftStyle } from '../../lib/api/giftIdeas'
import { foldText, type WishSignal } from './interests'

// Taste directions of a wishlist, read ON THE DEVICE (Felix 27.10: "скрипт должен анализировать бренд … если
// спортивный — предлагать какой-нибудь Gymshark"). Not "you have two kitchen things, so here is the kitchen":
// the BRANDS a list names (in a title or a link's host — the host is never contacted) and a few telling product
// words say what someone likes — athleisure, outdoor, Scandinavian design, specialty coffee … Only these few ids
// leave the device (lib/api/giftIdeas.ts `styles`); the Worker puts the catalogue's ideas of that taste first.
// - A hand-picked map of ~220 brands → one or two directions; brand names are matched as whole words (or two /
//   three words written together: "Under Armour" = "underarmour") and as the link's host name.
// - Product words count less than a brand. Every direction counts once per wish, weighted by "Wie sehr?".
// - Never a guess about the person (no gender, no age): a direction says what the list likes, nothing else.
// Pure: no network, no storage, no React.

export interface InferredStyle {
  id: GiftStyle
  score: number
}

/** At most this many go with a request: more would read like a profile. */
export const STYLES_SENT = 3
/** One brand at "Gern" (2) or two product words: a direction needs at least this much. */
const MIN_SCORE = 1.5
const BRAND_WEIGHT = 2
const WORD_WEIGHT = 1
const PRIORITY_WEIGHT: Readonly<Record<1 | 2 | 3, number>> = { 1: 0.7, 2: 1, 3: 1.5 }

type S = readonly GiftStyle[]
const AT: S = ['athleisure']
const AT_ST: S = ['athleisure', 'streetwear']
const AT_TE: S = ['athleisure', 'tech']
const OU: S = ['outdoor']
const SC: S = ['scandi']
const SC_CO: S = ['scandi', 'cozy']
const ST: S = ['streetwear']
const NA: S = ['natural']
const NA_CO: S = ['natural', 'cozy']
const CF: S = ['specialty-coffee']
const TEA: S = ['tea']
const AN: S = ['analog']
const AN_TE: S = ['analog', 'tech']
const CO: S = ['cozy']
const KP: S = ['kitchen-pro']
const KP_OU: S = ['kitchen-pro', 'outdoor']
const TE: S = ['tech']
const GA: S = ['gaming']
const GA_TE: S = ['gaming', 'tech']

/**
 * Brand → taste. Keys are folded (lower case, umlauts as ae/oe/ue, ß as ss, no spaces or signs): "Fjällräven"
 * = "fjaellraeven", "Under Armour" = "underarmour". Hosts are matched too ("fjallraven.com" → "fjallraven").
 * Ambiguous everyday words are left out on purpose (On, Global, Menu, Champion, Element, Jordan, Cos …).
 */
const BRANDS: Readonly<Record<string, S>> = {
  // athleisure, gym, running, yoga
  gymshark: AT, nike: AT_ST, adidas: AT_ST, puma: AT_ST, underarmour: AT, lululemon: AT, reebok: AT_ST, asics: AT,
  newbalance: AT_ST, hoka: AT, onrunning: AT, oncloud: AT, brooks: AT, saucony: AT, mizuno: AT, aloyoga: AT,
  castore: AT, hummel: AT_ST, kappa: AT_ST, fila: AT_ST, ellesse: AT_ST, oysho: AT,
  betterbodies: AT, myprotein: AT, foodspring: AT, esn: AT, morenutrition: AT, bodylab: AT, peloton: AT_TE,
  garmin: AT_TE, fitbit: AT_TE, whoop: AT_TE, coros: AT_TE, suunto: ['athleisure', 'outdoor'],
  therabody: AT, theragun: AT, blackroll: AT, liforme: AT, manduka: AT, domyos: AT, kipsta: AT, decathlon: AT,
  sportscheck: AT, smilodox: AT, gornation: AT, bauerfeind: AT, ronhill: AT, kalenji: AT,
  // outdoor
  fjaellraeven: OU, fjallraven: OU, vaude: OU, patagonia: OU, thenorthface: OU, northface: OU, jackwolfskin: OU,
  mammut: OU, arcteryx: OU, salomon: OU, deuter: OU, osprey: OU, blackdiamond: OU, petzl: OU, primus: OU, msr: OU,
  trangia: OU, petromax: KP_OU, kleankanteen: OU, hydroflask: OU, yeti: OU, stanley: OU, leatherman: OU,
  victorinox: ['outdoor', 'kitchen-pro'], opinel: KP_OU, morakniv: OU, hanwag: OU, meindl: OU, lowa: OU,
  lasportiva: OU, ortlieb: OU, seatosummit: OU, thermarest: OU, helinox: OU, snowpeak: OU, icebreaker: OU,
  smartwool: OU, haglofs: OU, haegloefs: OU, norrona: OU, bergans: OU, columbia: OU, schoeffel: OU, maiersports: OU,
  globetrotter: OU, bergfreunde: OU, campz: OU, tatonka: OU, exped: OU, ledlenser: OU, biolite: OU, gregory: OU,
  // minimal Scandinavian / Japanese design
  hay: SC, muuto: SC, normanncopenhagen: SC, normann: SC, fermliving: SC, stelton: SC, georgjensen: SC, iittala: SC,
  marimekko: SC, rosendahl: SC, designletters: SC, kaehler: SC, kahler: SC, housedoctor: SC_CO,
  broste: SC_CO, brostecopenhagen: SC_CO, bloomingville: SC_CO, andtradition: SC, louispoulsen: SC,
  vitra: SC, muji: SC, kinto: SC, evasolo: SC, rigtig: SC, zonedenmark: SC, aarke: SC, nordicnest: SC, arket: SC,
  menuspace: SC, audocopenhagen: SC, skagen: SC, lyngby: SC, holmegaard: SC, bodum: ['scandi', 'specialty-coffee'],
  // streetwear and sneakers
  carhartt: ST, carharttwip: ST, stussy: ST, stuessy: ST, supreme: ST, vans: ST, converse: ST, newera: ST, dickies: ST,
  patta: ST, kith: ST, bape: ST, thrasher: ST, santacruz: ST, obeyclothing: ST, snipes: ST, solebox: ST,
  asphaltgold: ST, footlocker: ST, jdsports: ST, sneakersnstuff: ST, afew: ST, offwhite: ST, palaceskateboards: ST,
  // natural cosmetics, slow and fair things
  weleda: NA, hauschka: NA, drhauschka: NA, iplusm: NA, ringana: NA, lavera: NA, logona: NA, sante: NA, alverde: NA,
  boerlind: NA, annemarieboerlind: NA, primavera: NA, farfalla: NA, tautropfen: NA, khadi: NA, lush: NA, aesop: NA,
  drbronner: NA, drbronners: NA, speick: NA, martinagebhardt: NA, hessnatur: NA_CO, armedangels: NA, grueneerde: NA_CO,
  avocadostore: NA, eccoverde: NA, glore: NA, waschbaer: NA, manomama: NA, ecoalf: NA, veja: ['natural', 'streetwear'],
  // specialty coffee
  hario: CF, chemex: CF, aeropress: CF, kalita: CF, comandante: CF, timemore: CF, baratza: CF, wilfa: CF,
  rocketespresso: CF, lamarzocco: CF, lelit: CF, bialetti: CF, acaia: CF, thebarn: CF, fiveelephant: CF,
  coffeecircle: CF, roeststaette: CF, quijote: CF, manvsmachine: CF, nomadcoffee: CF, timwendelboe: CF,
  squaremile: CF, nineteengrams: CF, '19grams': CF, machhoerndl: CF, elbgold: CF, jameshoffmann: CF, ecm: CF, profitec: CF,
  // tea
  teegschwendner: TEA, teekampagne: TEA, ronnefeldt: TEA, kusmi: TEA, kusmitea: TEA, mariagefreres: TEA, dammann: TEA,
  pukka: TEA, yogitea: TEA, sonnentor: ['tea', 'natural'], samova: TEA, paperandtea: TEA, chacult: TEA, teaworld: TEA,
  // analog: film, records, paper and pens
  leica: AN, lomography: AN, polaroid: AN, instax: AN, kodak: AN, ilford: AN, moleskine: AN, leuchtturm: AN,
  leuchtturm1917: AN, rhodia: AN, lamy: AN, pelikan: AN, kaweco: AN, fabercastell: AN, rega: AN_TE,
  projectaudio: AN_TE, audiotechnica: AN_TE, teenageengineering: AN_TE, midori: AN, hobonichi: AN,
  // cozy home
  yankeecandle: CO, lexington: CO, biederlack: CO, ugg: CO, glerups: CO,
  // kitchen pro
  lecreuset: KP, staub: KP, zwilling: KP, wuesthof: KP, wusthof: KP, shun: KP, miyabi: KP, fissler: KP, wmf: KP,
  debuyer: KP, kitchenaid: KP, kenwood: KP, thermomix: KP, ooni: KP, biggreenegg: KP,
  microplane: KP, emilehenry: KP, silit: KP, roesle: KP, gefu: KP, skeppshult: KP, ottolenghi: KP,
  // tech
  apple: TE, iphone: TE, ipad: TE, airpods: TE, macbook: TE, samsung: TE, cmf: TE,
  belkin: TE, logitech: TE, bose: TE, sony: TE, sennheiser: TE, jbl: TE, marshall: TE, sonos: TE, kindle: TE,
  tolino: TE, dji: TE, gopro: TE, raspberrypi: TE, philipshue: TE, nanoleaf: TE, ugreen: TE, nativeunion: TE,
  keychron: TE, bellroy: TE, beyerdynamic: TE, nuki: TE,
  // gaming
  nintendo: GA, nintendoswitch: GA, playstation: GA, ps5: GA, xbox: GA, steamdeck: GA, razer: GA_TE, steelseries: GA_TE,
  hyperx: GA_TE, logitechg: GA_TE, corsair: GA_TE, elgato: GA_TE, turtlebeach: GA, zelda: GA,
  pokemon: GA, supermario: GA, '8bitdo': GA, googlepixel: TE, stringfurniture: SC, webergrill: KP, minecraft: GA, finalfantasy: GA,
}

/** Brands whose name is also an everyday word (Nothing, Anker, Teufel, Tile, Weber …): only by the link's host. */
const HOST_BRANDS: Readonly<Record<string, S>> = {
  nothing: TE, anker: TE, teufel: TE, tile: TE, kai: KP, weber: KP, lodge: KP, polar: AT_TE, roguefitness: AT,
  strongerlabel: AT, arabia: SC, origami: CF, fellowproducts: CF, bonanzacoffee: CF, onrunning: AT, '43einhalb': ST,
}

/** A few telling product words (folded; matched inside a word: "Sportleggings" → "leggings"). */
const WORDS: Readonly<Record<GiftStyle, readonly string[]>> = {
  athleisure: ['leggings', 'sportbh', 'sportsbra', 'sporttop', 'trainingsshirt', 'trainingshose', 'jogginghose', 'joggers', 'gymbag', 'sporttasche', 'proteinshaker', 'protein', 'kettlebell', 'kurzhantel', 'fitnessuhr', 'laufschuh', 'runningshoe', 'faszienrolle', 'yogamatte', 'yogahose', 'workout', 'gym'],
  outdoor: ['wanderschuh', 'wanderrucksack', 'trekking', 'softshell', 'hardshell', 'regenjacke', 'fleecejacke', 'daunenjacke', 'schlafsack', 'isomatte', 'zelt', 'stirnlampe', 'campingkocher', 'outdoorjacke', 'funktionsjacke', 'klettergurt', 'bouldern'],
  scandi: ['skandinavisch', 'scandi', 'nordic', 'minimalistisch', 'designklassiker'],
  streetwear: ['streetwear', 'sneaker', 'skateboard', 'skate', 'oversized'],
  natural: ['naturkosmetik', 'biokosmetik', 'plastikfrei', 'zerowaste', 'nachhaltig', 'festesshampoo', 'seifenstueck', 'vegan'],
  'specialty-coffee': ['siebtraeger', 'handfilter', 'pourover', 'v60', 'kaffeebohnen', 'roesterei', 'specialty', 'filterkaffee', 'handmuehle', 'kaffeemuehle', 'milchkaennchen', 'baristawaage', 'tamper', 'espressobohnen'],
  tea: ['matcha', 'sencha', 'oolong', 'gruentee', 'schwarztee', 'losetee', 'teekanne', 'teeservice', 'kyusu', 'chasen', 'teesieb', 'earlgrey', 'rooibos', 'teeschale'],
  analog: ['plattenspieler', 'schallplatte', 'vinyl', 'sofortbild', 'analogkamera', 'kleinbildfilm', 'rollfilm', 'fuellfederhalter', 'fueller', 'notizbuch', 'schreibmaschine', 'kassette', 'walkman', 'tinte'],
  cozy: ['kuscheldecke', 'wolldecke', 'plaid', 'duftkerze', 'kerze', 'hausschuhe', 'pantoffel', 'bettsocken', 'waermflasche', 'waermeflasche', 'hygge', 'lichterkette', 'strickdecke'],
  'kitchen-pro': ['kochmesser', 'santoku', 'damastmesser', 'gusseisen', 'wetzstein', 'schleifstein', 'braeter', 'kupferpfanne', 'pizzastein', 'pizzaofen', 'sousvide', 'messerblock', 'eisenpfanne'],
  tech: ['powerbank', 'ladestation', 'smartwatch', 'smarthome', 'drohne', 'gadget', 'tablet', 'ebookreader', 'noisecancelling'],
  gaming: ['konsole', 'controller', 'gaming', 'videospiel', 'gamepad'],
}

const WORD_ENTRIES: ReadonlyArray<readonly [string, GiftStyle]> = GIFT_STYLES.flatMap((style) => WORDS[style].map((word) => [word, style] as const))
  // longest first: "kaffeemuehle" before a shorter word inside it
  .sort((a, b) => b[0].length - a[0].length)

/** The host's name parts ("www.de.gymshark.com" → ["gymshark", "de"]; "under-armour.de" → ["underarmour", "under", "armour"]). */
function hostKeys(url: string | null): string[] {
  if (!url) return []
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return []
  }
  const labels = host.replace(/^www\./, '').split('.').slice(0, -1)
  return labels.flatMap((label) => [label.replace(/-/g, ''), ...label.split('-')]).filter((key) => key.length > 1)
}

/** The brands a wish names (each once). */
export function brandsOf(title: string, url: string | null): string[] {
  const words = foldText(title).split(' ').filter(Boolean)
  const hosts = hostKeys(url)
  const keys = new Set<string>([...words, ...hosts])
  for (let i = 0; i < words.length - 1; i += 1) {
    keys.add(`${words[i]}${words[i + 1]}`)
    if (i < words.length - 2) keys.add(`${words[i]}${words[i + 1]}${words[i + 2]}`)
  }
  return [...[...keys].filter((key) => Object.hasOwn(BRANDS, key)), ...hosts.filter((key) => Object.hasOwn(HOST_BRANDS, key) && !Object.hasOwn(BRANDS, key))]
}

/** The directions one wish says, with how strongly (a brand counts more than a product word). */
export function stylesOfWish(title: string, url: string | null): Map<GiftStyle, number> {
  const found = new Map<GiftStyle, number>()
  const add = (style: GiftStyle, weight: number) => found.set(style, Math.max(found.get(style) ?? 0, weight))
  for (const brand of brandsOf(title, url)) for (const style of BRANDS[brand] ?? HOST_BRANDS[brand] ?? []) add(style, BRAND_WEIGHT)
  const folded = foldText(title)
  const words = folded.split(' ').filter(Boolean)
  for (const word of words) {
    for (const [keyword, style] of WORD_ENTRIES) {
      if (keyword.length > word.length) continue
      // short words only as a whole word ("gym", "tablet" — never "Tablett"), longer ones also inside a compound
      if (keyword.length <= 6 ? word === keyword : word.includes(keyword)) add(style, WORD_WEIGHT)
    }
  }
  return found
}

/**
 * The taste directions of a wishlist, strongest first: each wish adds its directions once (brand 2, product word
 * 1), weighted by "Wie sehr?"; a direction needs MIN_SCORE; at most `max` (default three).
 */
export function inferStyles(signals: readonly WishSignal[], max = STYLES_SENT): InferredStyle[] {
  const scores = new Map<GiftStyle, { score: number; first: number }>()
  let order = 0
  for (const wish of signals) {
    const weight = PRIORITY_WEIGHT[wish.priority] ?? 1
    for (const [style, strength] of stylesOfWish(wish.title, wish.url)) {
      const entry = scores.get(style) ?? { score: 0, first: order++ }
      entry.score += strength * weight
      scores.set(style, entry)
    }
  }
  return [...scores.entries()]
    .filter(([, entry]) => entry.score >= MIN_SCORE)
    .sort((a, b) => b[1].score - a[1].score || a[1].first - b[1].first)
    .slice(0, Math.max(0, max))
    .map(([id, entry]) => ({ id, score: Math.round(entry.score * 100) / 100 }))
}

/** How many brands the map knows (tests, docs). */
export const KNOWN_BRANDS = Object.keys(BRANDS).length + Object.keys(HOST_BRANDS).length
