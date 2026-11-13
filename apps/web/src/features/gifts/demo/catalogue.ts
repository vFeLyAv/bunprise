import type { GiftInterest, GiftStyle } from '../../../lib/api/giftIdeas'

// The demo catalogue of "Geschenk finden": INVENTED products from INVENTED shops on reserved example
// domains (RFC 2606 — they cannot exist), approximate prices, pictures drawn by us (features/gifts/art).
// No real product, brand, shop or photo. It serves the demo server (src/mocks/giftIdeas.ts) and, until a
// partner program is decided (Felix), the device itself when our Worker has no provider yet.
// `rank` = the order of "popular" ideas when nothing is personalised (1 = first); every rank once.

export interface DemoShop {
  name: string
  host: string
}

export const DEMO_SHOPS = {
  markt: { name: 'Markt', host: 'markt.example' },
  kaufhaus: { name: 'Kaufhaus Mitte', host: 'kaufhaus.example' },
  // the far-away marketplace: cheapest, slowest
  fernost: { name: 'Fernost-Versand', host: 'fernost.example' },
  laedchen: { name: 'Lädchen', host: 'laedchen.example' },
  buecherstube: { name: 'Bücherstube', host: 'buecherstube.example' },
  sportwelt: { name: 'Sportwelt', host: 'sportwelt.example' },
  technik: { name: 'Technikhaus', host: 'technik.example' },
  gruenzeug: { name: 'Grünzeug', host: 'gruenzeug.example' },
} as const satisfies Record<string, DemoShop>

export type DemoShopId = keyof typeof DEMO_SHOPS

export interface DemoProduct {
  id: string
  /** the drawing (features/gifts/art) */
  art: string
  interests: readonly GiftInterest[]
  title: { de: string; en: string }
  offers: ReadonlyArray<readonly [DemoShopId, number]>
  rank: number
  /** taste directions (27.10, like the Worker's catalogue): the demo deck puts these first for a matching list */
  styles?: readonly GiftStyle[]
}

const p = (
  id: string,
  art: string,
  interests: readonly GiftInterest[],
  de: string,
  en: string,
  offers: ReadonlyArray<readonly [DemoShopId, number]>,
  rank: number,
): DemoProduct => ({ id: `demo-${id}`, art, interests, title: { de, en }, offers, rank, ...(DEMO_STYLES[id] ? { styles: DEMO_STYLES[id] } : {}) })

/** The demo's taste directions per product (invented products, honest tags). */
const DEMO_STYLES: Readonly<Record<string, readonly GiftStyle[]>> = {
  headphones: ['tech'], headset: ['gaming'], speaker: ['tech'], grinder: ['specialty-coffee'], pourover: ['specialty-coffee'], teapot: ['tea'],
  thermos: ['outdoor'], lantern: ['outdoor'], controller: ['gaming'], scarf: ['scandi', 'cozy'], tote: ['streetwear'], bathset: ['natural'],
  handcream: ['natural'], camera: ['analog'], album: ['analog'], yogamat: ['athleisure', 'natural'], bottle: ['athleisure', 'outdoor'],
  gymbag: ['athleisure'], shaker: ['athleisure'], knife: ['kitchen-pro'], vinyl: ['analog'], powerbank: ['tech'], lamp: ['tech', 'scandi'],
  candle: ['cozy'], lights: ['cozy'], throw: ['cozy'], sketchbook: ['analog'],
}

export const DEMO_PRODUCTS: readonly DemoProduct[] = [
  // audio
  p('headphones', 'headphones', ['audio', 'music', 'tech'], 'Kabellose Over-Ear-Kopfhörer', 'Wireless over-ear headphones', [['markt', 6990], ['technik', 7490], ['fernost', 2890]], 3),
  p('headset', 'headphones', ['gaming', 'audio'], 'Gaming-Headset mit Mikrofon', 'Gaming headset with microphone', [['technik', 4990], ['markt', 4590], ['fernost', 1990]], 27),
  p('speaker', 'speaker', ['audio', 'outdoor', 'tech'], 'Kleiner Bluetooth-Lautsprecher', 'Small Bluetooth speaker', [['markt', 3490], ['technik', 3990], ['fernost', 1490]], 8),
  // coffee & tea
  p('grinder', 'grinder', ['coffee', 'kitchen'], 'Handmühle aus Walnussholz', 'Walnut hand grinder', [['laedchen', 3900], ['markt', 3490], ['fernost', 1690]], 2),
  p('pourover', 'pourover', ['coffee'], 'Pour-over-Set aus Keramik', 'Ceramic pour-over set', [['laedchen', 3200], ['kaufhaus', 2990]], 12),
  p('teapot', 'teapot', ['coffee', 'home'], 'Teekanne mit Sieb, 1 Liter', 'Teapot with infuser, 1 litre', [['kaufhaus', 2490], ['laedchen', 2990], ['fernost', 1190]], 17),
  // books
  p('photobook', 'books', ['books', 'travel', 'photo'], 'Bildband „Nordlichter“', 'Photo book “Northern Lights”', [['buecherstube', 3900], ['markt', 3600]], 14),
  p('crimebox', 'books', ['books'], 'Krimi-Box mit drei Taschenbüchern', 'Crime box with three paperbacks', [['buecherstube', 2900], ['markt', 2700]], 9),
  p('bookmarks', 'openbook', ['books'], 'Lesezeichen aus Messing, 3 Stück', 'Brass bookmarks, set of three', [['buecherstube', 1490], ['laedchen', 1690], ['fernost', 590]], 26),
  // outdoors
  p('thermos', 'thermos', ['outdoor', 'travel', 'coffee'], 'Thermoskanne, 0,75 Liter', 'Insulated flask, 0.75 litre', [['sportwelt', 2990], ['markt', 2490], ['fernost', 1190]], 6),
  p('lantern', 'lantern', ['outdoor', 'home'], 'Campinglaterne mit Akku', 'Rechargeable camping lantern', [['sportwelt', 3490], ['technik', 3290], ['fernost', 1490]], 19),
  p('picnic', 'blanket', ['outdoor', 'home'], 'Picknickdecke, wasserdicht', 'Waterproof picnic blanket', [['kaufhaus', 3490], ['markt', 2990]], 23),
  // gaming
  p('controller', 'controller', ['gaming', 'tech'], 'Kabelloser Controller', 'Wireless controller', [['technik', 5990], ['markt', 5490], ['fernost', 1990]], 11),
  // games
  p('boardgame', 'boardgame', ['games'], 'Brettspiel für zwei', 'Board game for two', [['laedchen', 2990], ['markt', 2690]], 4),
  p('puzzle', 'puzzle', ['games', 'creative'], 'Puzzle „Bücherregal“, 1000 Teile', '“Bookshelf” puzzle, 1000 pieces', [['kaufhaus', 1990], ['markt', 1790], ['fernost', 990]], 15),
  p('cardgame', 'cards', ['games'], 'Kartenspiel für Spieleabende', 'Card game for game nights', [['laedchen', 1290], ['markt', 1190]], 21),
  // fashion
  p('scarf', 'scarf', ['fashion'], 'Strickschal aus Merinowolle', 'Merino knit scarf', [['kaufhaus', 4490], ['laedchen', 4900], ['fernost', 1890]], 7),
  p('tote', 'tote', ['fashion'], 'Jutebeutel mit Stickerei', 'Embroidered tote bag', [['laedchen', 1890], ['fernost', 690]], 25),
  p('knitkit', 'yarn', ['creative', 'fashion'], 'Strickset für Anfänger', 'Beginner’s knitting kit', [['laedchen', 3490], ['fernost', 1290]], 30),
  // self-care
  p('bathset', 'bathset', ['beauty', 'home'], 'Badeset mit Badesalz und Seife', 'Bath set with salts and soap', [['kaufhaus', 2490], ['laedchen', 2790]], 16),
  p('handcream', 'tubes', ['beauty'], 'Handcreme-Trio', 'Hand cream trio', [['kaufhaus', 1690], ['markt', 1490], ['fernost', 790]], 29),
  // plants
  p('monstera', 'plant', ['plants', 'home'], 'Monstera im Keramiktopf', 'Monstera in a ceramic pot', [['gruenzeug', 3490], ['markt', 3990]], 1),
  p('herbs', 'herbs', ['plants', 'kitchen'], 'Kräutergarten fürs Fensterbrett', 'Windowsill herb garden', [['gruenzeug', 2490], ['kaufhaus', 2690], ['fernost', 1090]], 20),
  // photo
  p('camera', 'camera', ['photo', 'tech'], 'Sofortbildkamera', 'Instant camera', [['technik', 7990], ['markt', 7490], ['fernost', 3990]], 5),
  p('album', 'album', ['photo', 'creative'], 'Fotoalbum aus Leinen', 'Linen photo album', [['buecherstube', 2490], ['laedchen', 2890], ['kaufhaus', 2290]], 24),
  // sport
  p('yogamat', 'yoga', ['sport'], 'Yogamatte aus Kork', 'Cork yoga mat', [['sportwelt', 4490], ['markt', 3990], ['fernost', 1890]], 10),
  p('bottle', 'bottle', ['sport', 'outdoor'], 'Trinkflasche aus Edelstahl', 'Stainless steel water bottle', [['sportwelt', 2490], ['markt', 1990], ['fernost', 890]], 22),
  p('gymbag', 'tote', ['sport', 'fashion'], 'Sporttasche mit Schuhfach', 'Gym bag with a shoe compartment', [['sportwelt', 4490], ['markt', 3990]], 45),
  p('shaker', 'bottle', ['sport'], 'Protein-Shaker mit Pulverfach', 'Protein shaker with a powder compartment', [['sportwelt', 1490], ['markt', 1290], ['fernost', 590]], 46),
  // travel
  p('worldmap', 'map', ['travel', 'home'], 'Rubbel-Weltkarte', 'Scratch-off world map', [['laedchen', 2490], ['buecherstube', 2290], ['fernost', 990]], 13),
  p('pillow', 'pillow', ['travel'], 'Reisekissen aus Memory-Schaum', 'Memory-foam travel pillow', [['markt', 2490], ['fernost', 990]], 33),
  // kitchen
  p('knife', 'knife', ['kitchen'], 'Kochmesser mit Holzgriff', 'Chef’s knife with a wooden handle', [['kaufhaus', 5990], ['laedchen', 6490], ['fernost', 2290]], 18),
  p('spices', 'spices', ['kitchen', 'travel'], 'Gewürzset „Weltreise“', '“World tour” spice set', [['laedchen', 2490], ['markt', 2290]], 28),
  p('towels', 'blanket', ['kitchen', 'home'], 'Leinen-Geschirrtücher, 3 Stück', 'Linen tea towels, set of three', [['laedchen', 2190], ['kaufhaus', 1990]], 34),
  p('grilltools', 'tongs', ['kitchen', 'outdoor'], 'Grillbesteck, dreiteilig', 'Three-piece barbecue tool set', [['markt', 2490], ['sportwelt', 2790], ['fernost', 990]], 31),
  // music
  p('vinyl', 'vinyl', ['music'], 'Schallplatte „Jazz am Abend“', 'Vinyl record “Evening Jazz”', [['markt', 2490], ['laedchen', 2790]], 32),
  p('ukulele', 'ukulele', ['music', 'creative'], 'Ukulele für Einsteiger', 'Beginner’s ukulele', [['markt', 4990], ['laedchen', 5490], ['fernost', 2290]], 35),
  // tech
  p('powerbank', 'powerbank', ['tech', 'travel'], 'Powerbank, 10 000 mAh', '10,000 mAh power bank', [['technik', 2990], ['markt', 2490], ['fernost', 1290]], 36),
  p('lamp', 'lamp', ['tech', 'home'], 'Smarte Tischlampe', 'Smart table lamp', [['technik', 4990], ['kaufhaus', 5490], ['fernost', 2190]], 37),
  // home
  p('candle', 'candle', ['home', 'beauty'], 'Duftkerze im Glas', 'Scented candle in a glass', [['laedchen', 2290], ['kaufhaus', 1990], ['fernost', 790]], 38),
  p('lights', 'lights', ['home', 'outdoor'], 'Lichterkette mit 50 LEDs', 'String lights with 50 LEDs', [['markt', 1990], ['kaufhaus', 2190], ['fernost', 690]], 39),
  p('throw', 'blanket', ['home'], 'Kuscheldecke aus Baumwolle', 'Cotton throw blanket', [['kaufhaus', 4990], ['markt', 4490]], 40),
  // film
  p('popcorn', 'popcorn', ['film', 'kitchen'], 'Popcorn-Set für den Filmabend', 'Movie-night popcorn set', [['laedchen', 1990], ['markt', 1790]], 41),
  p('cinema', 'popcorn', ['film'], 'Kinogutschein für zwei', 'Cinema voucher for two', [['markt', 2400], ['kaufhaus', 2500]], 42),
  // creative
  p('paints', 'paints', ['creative'], 'Aquarellkasten mit Pinseln', 'Watercolour set with brushes', [['laedchen', 2990], ['kaufhaus', 2690], ['fernost', 990]], 43),
  p('sketchbook', 'album', ['creative', 'books'], 'Skizzenbuch A5, Leinen', 'A5 linen sketchbook', [['buecherstube', 1490], ['laedchen', 1690]], 44),
]

/** Every art id the catalogue uses (features/gifts/art draws each of them). */
export const DEMO_ART_IDS: readonly string[] = [...new Set(DEMO_PRODUCTS.map((product) => product.art))]
