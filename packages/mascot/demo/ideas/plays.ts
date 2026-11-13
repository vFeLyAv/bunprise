/**
 * Every game of the "Brettspiele" draft (docs/research/2026-10-26-board-games.catalog-draft.json, 24 entries) with
 * what the gallery needs beyond the card: its animation archetype + look (scenes.ts), the "So wird gespielt" summary
 * (= the draft's how_to_play.de; test/ideas-categories.test.ts keeps them equal) and — when the shop page named a
 * usable one — its real photo.
 *
 * Photos (Felix 26.10: «добавь так же к играм настоящее фото игры»): found ONCE with the rules of
 * workers/edge/scripts/catalog-photos.mjs (robots.txt, ≤ 1 request / 2 s per shop, the picture the page names,
 * raster only, ≤ 2 MB, ≥ 300 px) and saved into demo/ideas/photos/ — that folder is git-ignored, they are the shops'
 * pictures (closed-pilot rule, docs/handoffs/2026-10-25-catalog-photos.md). The gallery loads them from the gallery
 * server only: the browser never contacts a shop. A missing file (another checkout) just drops the photo slide.
 * In the app the photo would come through the Worker route /api/gift-ideas/img/<art>/<id> (image_source of the draft).
 */

import type { Look } from './scenes';

export interface Play {
  name: string;
  look: Look;
  /** "So wird gespielt" (German, ≤ 300 characters, our own words from the official rules) */
  howTo: string;
}

const T = (color: string, detail: 'road' | 'city' | 'tree' | 'wave' | 'wheat' | 'house' | 'field' | 'rock') => ({ color, detail });

export const PLAYS: Readonly<Record<string, Play>> = {
  'cat:hig-carcassonne': {
    name: 'Carcassonne',
    look: { archetype: 'tiles', shape: 'square', tiles: [T('var(--g-leaf-light)', 'city'), T('var(--g-leaf-light)', 'road'), T('var(--g-leaf-light)', 'field'), T('var(--g-leaf-light)', 'road')], token: 'meeple', tokenColor: 'var(--g-clay)' },
    howTo: 'Wer dran ist, zieht ein Landschaftsplättchen und legt es passend an: Straßen, Städte und Wiesen laufen weiter. Danach darf man einen Gefolgsmann auf ein freies Gebiet setzen. Fertige Straßen, Städte und Klöster punkten sofort. Liegt das letzte Plättchen, gewinnt die höchste Punktzahl.',
  },
  'cat:dow-zug-um-zug': { name: 'Zug um Zug', look: { archetype: 'route', wagon: 'var(--g-clay)', cards: ['var(--g-clay)', 'var(--g-sky-dark)', 'var(--g-leaf)'] }, howTo: 'Pro Zug machst du genau eins: zwei Wagenkarten nehmen, mit gleichfarbigen Karten eine Strecke bauen oder neue Zielkarten ziehen. Strecken und erfüllte Ziele bringen Punkte, offene Ziele kosten welche. Hat jemand nur noch 0–2 Waggons, gibt es eine letzte Runde.' },
  'cat:cge-codenames': { name: 'Codenames', look: { archetype: 'words', variant: 'codenames' }, howTo: 'Zwei Teams, je ein Geheimdienstchef. Er nennt ein Wort und eine Zahl, sein Team tippt passende Begriffe auf dem Tisch an. Ein falsches Wort beendet den Zug; wer den Attentäter erwischt, verliert sofort. Wer zuerst alle eigenen Agenten findet, gewinnt.' },
  'cat:libellud-dixit': { name: 'Dixit', look: { archetype: 'words', variant: 'dixit' }, howTo: 'Reihum sagt eine Person zu einer ihrer Bildkarten ein Wort, einen Satz oder ein Geräusch. Die anderen legen verdeckt eine passende Karte dazu, dann wird geraten, welche die echte ist. Errät es niemand oder jeder, geht die Erzählerin leer aus. Ab 30 Punkten ist Schluss.' },
  'cat:nextmove-azul': { name: 'Azul', look: { archetype: 'pattern', variant: 'azul' }, howTo: 'Du nimmst alle Fliesen einer Farbe aus einer Manufaktur oder der Tischmitte und legst sie in eine Musterreihe; was nicht passt, gibt Minuspunkte. Volle Reihen kommen am Rundenende an deine Wand und punkten. Hat jemand eine waagrechte Reihe voll, endet das Spiel.' },
  'cat:feuerland-fluegelschlag': { name: 'Flügelschlag', look: { archetype: 'pattern', variant: 'birds' }, howTo: 'In jedem Zug setzt du einen Aktionswürfel ein: Vogel ausspielen, Futter nehmen, Eier legen oder Karten ziehen. Danach helfen die Vögel in dieser Reihe mit ihren Fähigkeiten – so wächst eine kleine Vogel-Maschine. Nach vier Runden zählen Vögel, Eier, Futter und Rundenziele.' },
  'cat:pegasus-kingdomino': {
    name: 'Kingdomino',
    look: { archetype: 'tiles', shape: 'square', tiles: [T('var(--g-butter)', 'wheat'), T('var(--g-leaf)', 'tree'), T('var(--g-sky)', 'wave'), T('var(--g-leaf-dark)', 'tree')], token: 'crown', tokenColor: 'var(--g-butter-dark)' },
    howTo: 'Jede Runde wählst du mit deinem König einen Dominostein und legst ihn an dein Reich an – mindestens eine Landschaft muss passen, alles bleibt in 5×5 Feldern. Wer einen starken Stein nimmt, wählt danach später. Am Ende zählt jedes Gebiet: Felder mal Kronen.',
  },
  'cat:repos-7-wonders-duel': { name: '7 Wonders Duel', look: { archetype: 'pattern', variant: 'wonders' }, howTo: 'Ihr nehmt abwechselnd eine offene Karte aus der Auslage und baut sie, tauscht sie gegen Münzen oder baut damit ein Weltwunder. Wer militärisch die gegnerische Hauptstadt erreicht oder sechs Wissenschaftssymbole hat, gewinnt sofort – sonst nach drei Zeitaltern die meisten Punkte.' },
  'cat:schmidt-quacksalber': { name: 'Die Quacksalber von Quedlinburg', look: { archetype: 'luck', variant: 'cauldron' }, howTo: 'Alle ziehen gleichzeitig Zutaten aus dem eigenen Beutel in ihren Kessel und hören auf, wann sie wollen. Zu viele Knallerbsen, und der Kessel explodiert. Danach gibt es Punkte und neue Zutaten für den Beutel. Nach neun Runden gewinnt, wer die meisten Punkte hat.' },
  'cat:kosmos-cascadia': {
    name: 'Cascadia',
    look: { archetype: 'tiles', shape: 'hex', tiles: [T('var(--g-leaf)', 'tree'), T('var(--g-sky)', 'wave'), T('var(--g-steel)', 'rock'), T('var(--g-butter)', 'wheat')], token: 'animal', tokenColor: 'var(--g-clay)' },
    howTo: 'Du nimmst eins von vier offenen Paaren aus Landschaftsplättchen und Tier, legst das Plättchen an deine Landschaft und setzt das Tier auf ein passendes Feld. Nach 20 Zügen zählen die Tiermuster der Wertungskarten und deine größten zusammenhängenden Lebensräume.',
  },
  'cat:pegasus-dorfromantik': {
    name: 'Dorfromantik',
    look: { archetype: 'tiles', shape: 'hex', tiles: [T('var(--g-leaf)', 'tree'), T('var(--g-butter)', 'wheat'), T('var(--g-sky)', 'wave'), T('var(--g-leaf-light)', 'house')], token: 'flag', tokenColor: 'var(--g-rose-dark)' },
    howTo: 'Alle spielen zusammen: Reihum wird ein Sechseck-Plättchen aufgedeckt und gemeinsam angelegt. Aufträge verlangen etwa genau sechs Felder Wald – erfüllt bringen sie Punkte. Sind die Plättchen aufgebraucht, zählt das Team; in der Kampagne schaltet ihr so Neues frei.',
  },
  'cat:repos-just-one': { name: 'Just One', look: { archetype: 'words', variant: 'justone' }, howTo: 'Eine Person rät, alle anderen schreiben heimlich einen Ein-Wort-Hinweis zum geheimen Begriff. Doppelte Hinweise werden vorher gestrichen. Dann gibt es genau einen Rateversuch. Nach 13 Karten zählt das Team, wie viele Begriffe es gemeinsam erraten hat.' },
  'cat:cocktail-hanabi': { name: 'Hanabi', look: { archetype: 'coop', variant: 'hanabi' }, howTo: 'Alle spielen zusammen und halten ihre Karten verkehrt herum: Man sieht die der anderen, nur die eigenen nicht. Pro Zug gibt man einen Hinweis (Farbe oder Zahl), wirft ab oder spielt eine Karte aus. Ziel sind fünf Feuerwerke von 1 bis 5; drei Fehler beenden das Spiel.' },
  'cat:nsv-the-mind': { name: 'The Mind', look: { archetype: 'coop', variant: 'mind' }, howTo: 'Alle legen gemeinsam ihre Zahlenkarten (1–100) auf einen Stapel – aufsteigend, ohne feste Reihenfolge und ohne ein Wort. Wer glaubt, die kleinste Zahl zu haben, legt einfach. Ein Fehler kostet ein Leben. Schafft ihr alle Level, gewinnt ihr zusammen.' },
  'cat:spacecowboys-skull': { name: 'Skull', look: { archetype: 'luck', variant: 'discs' }, howTo: 'Jede Person hat drei Blumen und einen Totenkopf. Reihum legt man verdeckt eine Scheibe ab – oder wettet, wie viele Scheiben man aufdecken kann, ohne einen Totenkopf zu treffen. Wer bietet, deckt zuerst die eigenen auf. Zwei geschaffte Wetten gewinnen.' },
  'cat:amigo-wizard': { name: 'Wizard', look: { archetype: 'luck', variant: 'trick' }, howTo: 'In jeder Runde gibt es eine Karte mehr. Alle sagen vorher an, wie viele Stiche sie machen; Farbe muss bedient werden, Zauberer gewinnen, Narren verlieren immer. Genau getroffen bringt Punkte, daneben kostet welche. Sind alle Karten verteilt, ist Schluss.' },
  'cat:zman-challengers': { name: 'Challengers!', look: { archetype: 'luck', variant: 'duel' }, howTo: 'Sieben Runden lang verbessert jede Person ihr Kartendeck und tritt dann im Duell an: Karten aufdecken, bis eine stark genug ist, die Fahne zu holen – wer sie nicht zurückholt, verliert. Siege bringen Fans. Die zwei mit den meisten Fans spielen das Finale.' },
  'cat:jumbo-hitster': { name: 'Hitster', look: { archetype: 'music', variant: 'timeline' }, howTo: 'Ein Handy spielt über die kostenlose Hitster-App den Song der Karte. Wer dran ist, legt die Karte in seinen Zeitstrahl – davor, dahinter oder dazwischen – und dreht sie um: Stimmt das Jahr, bleibt sie liegen. Wer zuerst zehn Karten richtig liegen hat, gewinnt.' },
  'cat:kosmos-exit-verlassene-huette': { name: 'EXIT – Die verlassene Hütte', look: { archetype: 'coop', variant: 'lock' }, howTo: 'Alle rätseln gemeinsam mit Buch, Rätselkarten und seltsamen Gegenständen; das Material darf beschrieben, geknickt und zerschnitten werden. Codes prüft man mit der Codescheibe, Hilfekarten helfen weiter. Ist das letzte Rätsel gelöst, seid ihr frei. Nur einmal spielbar.' },
  'cat:pegasus-everdell': { name: 'Everdell', look: { archetype: 'pattern', variant: 'city' }, howTo: 'Pro Zug machst du eins: einen Arbeiter einsetzen und Rohstoffe oder Karten holen, eine Kreatur oder ein Gebäude in deine Stadt spielen oder dich auf die nächste Jahreszeit vorbereiten. Nach dem Herbst ist für alle Schluss; die wertvollste Stadt gewinnt.' },
  'cat:pegasus-bomb-busters': { name: 'Bomb Busters', look: { archetype: 'coop', variant: 'wires' }, howTo: 'Alle entschärfen zusammen eine Bombe. Jede Person hat sortierte Kabel mit Zahlen; man zeigt auf ein Kabel einer Mitspielerin und nennt eine Zahl, die man selbst hat. Stimmt sie, sind beide durchtrennt, sonst rückt der Zünder vor – sind alle Kabel geschnitten, ist die Bombe sicher.' },
  'cat:gamefactory-dito': { name: 'Dito!', look: { archetype: 'words', variant: 'dito' }, howTo: 'Drei Kategorien pro Runde, zu jeder schreibt jede Person heimlich drei Begriffe. Dann wird vorgelesen: Wer dasselbe hat, punktet; ist es genau ein Paar, gibt es einen Extra-Stern. Volle Reihen bringen Boni. Nach drei Runden gewinnt die höchste Punktzahl.' },
  'cat:frosted-rebirth': {
    name: 'Rebirth',
    look: { archetype: 'tiles', shape: 'hex', tiles: [T('var(--g-leaf-light)', 'field'), T('var(--g-sky)', 'wave'), T('var(--g-wood-light)', 'rock'), T('var(--g-leaf-light)', 'house')], token: 'house', tokenColor: 'var(--g-clay-dark)' },
    howTo: 'Pro Zug legst du dein Plättchen – Nahrung, Energie oder Siedlung – auf ein passendes Feld der Schottland-Karte und punktest sofort: Felder nach Größe der Gruppe, Siedlungen nach Mehrheit. Dann ziehst du nach. Sind alle Plättchen gelegt, folgt die Schlusswertung.',
  },
  'cat:schmidt-ganz-schoen-clever': { name: 'Ganz schön clever', look: { archetype: 'dice', variant: 'clever' }, howTo: 'Wer dran ist, würfelt bis zu dreimal mit sechs Würfeln, behält jedes Mal einen und trägt ihn im Bereich seiner Farbe ein; kleinere Würfel gehen aufs Silbertablett für die anderen. Kluge Einträge lösen Kettenreaktionen aus. Nach 4–6 Runden gewinnt die höchste Summe.' },
};

/** The photo of a game in demo/ideas/photos/ (git-ignored) and the shop it comes from ("Bild: Müller"). */
export const PHOTOS: Readonly<Record<string, { file: string; shop: string }>> = {
  'cat:repos-7-wonders-duel': { file: 'repos-7-wonders-duel.jpg', shop: 'Hugendubel' },
  'cat:hig-carcassonne': { file: 'hig-carcassonne.webp', shop: 'MediaMarkt' },
  'cat:cocktail-hanabi': { file: 'cocktail-hanabi.jpg', shop: 'Alternate' },
  'cat:spacecowboys-skull': { file: 'spacecowboys-skull.jpg', shop: 'Hugendubel' },
  'cat:cge-codenames': { file: 'cge-codenames.webp', shop: 'Müller' },
  'cat:pegasus-dorfromantik': { file: 'pegasus-dorfromantik.png', shop: 'MediaMarkt' },
  'cat:zman-challengers': { file: 'zman-challengers.png', shop: 'MediaMarkt' },
  'cat:amigo-wizard': { file: 'amigo-wizard.webp', shop: 'Alternate' },
  'cat:libellud-dixit': { file: 'libellud-dixit.webp', shop: 'Müller' },
  'cat:pegasus-everdell': { file: 'pegasus-everdell.webp', shop: 'Alternate' },
  'cat:nextmove-azul': { file: 'nextmove-azul.webp', shop: 'Müller' },
  'cat:feuerland-fluegelschlag': { file: 'feuerland-fluegelschlag.webp', shop: 'Müller' },
  'cat:pegasus-kingdomino': { file: 'pegasus-kingdomino.webp', shop: 'Müller' },
  'cat:schmidt-quacksalber': { file: 'schmidt-quacksalber.webp', shop: 'Müller' },
  'cat:kosmos-cascadia': { file: 'kosmos-cascadia.webp', shop: 'Müller' },
  'cat:repos-just-one': { file: 'repos-just-one.webp', shop: 'Müller' },
  'cat:nsv-the-mind': { file: 'nsv-the-mind.webp', shop: 'Müller' },
  'cat:jumbo-hitster': { file: 'jumbo-hitster.webp', shop: 'Müller' },
  'cat:kosmos-exit-verlassene-huette': { file: 'kosmos-exit-verlassene-huette.webp', shop: 'Müller' },
  'cat:pegasus-bomb-busters': { file: 'pegasus-bomb-busters.webp', shop: 'Müller' },
  'cat:gamefactory-dito': { file: 'gamefactory-dito.webp', shop: 'Müller' },
  'cat:frosted-rebirth': { file: 'frosted-rebirth.webp', shop: 'Müller' },
  'cat:schmidt-ganz-schoen-clever': { file: 'schmidt-ganz-schoen-clever.webp', shop: 'Müller' },
};

/**
 * The folder of the photos on the gallery server (next to this module). Built from import.meta.url as a plain
 * string on purpose: Vite does not try to resolve it at build time, so a checkout without the (git-ignored) photos
 * still builds and simply shows no photo slide.
 */
export const PHOTO_BASE: string = `${import.meta.url.replace(/[?#].*$/, '').replace(/[^/]*$/, '')}photos/`;

export function photoUrl(id: string): string | null {
  const p = PHOTOS[id];
  return p ? `${PHOTO_BASE}${encodeURIComponent(p.file)}` : null;
}
