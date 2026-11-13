import { describe, expect, it } from 'vitest'
import type { ConsentKind, Locale } from '../../lib/api/types'
import { LEGAL_VERSIONS } from '../../lib/legal'
import { hasLegalText, IMPRINT_VERSION, loadLegalText } from './archive'

describe('exact legal archives', () => {
  it.each(['de', 'en'] as const)('provides the exact server-mirrored text for every record kind in %s', async (locale) => {
    for (const kind of Object.keys(LEGAL_VERSIONS) as ConsentKind[]) {
      const version = LEGAL_VERSIONS[kind]
      expect(hasLegalText(kind, version, locale)).toBe(true)
      const document = await loadLegalText(kind, version, locale)
      expect(document).toMatchObject({ kind, version, locale })
      expect(document?.text).toContain(version)
      expect(document?.text).toContain(locale === 'de' ? 'ENTWURF' : 'DRAFT')
    }
  })

  it('never substitutes a different version, record kind or unsupported language', async () => {
    expect(await loadLegalText('terms', 'unpublished-server-version', 'de')).toBeNull()
    expect(await loadLegalText('terms', LEGAL_VERSIONS.privacy_notice, 'de')).toBeNull()
    expect(await loadLegalText('terms', LEGAL_VERSIONS.terms, 'fr' as Locale)).toBeNull()
    expect(hasLegalText('terms', '../terms-2026-10-pilot-1', 'de')).toBe(false)
  })

  // Felix 24.10: provider name and work e-mail as he gave them, no postal address, the provider lines at the end, dated 24.10.2026.
  it('names the provider Felix gave, without an address, at the end of the imprint in both languages', async () => {
    for (const locale of ['de', 'en'] as const) {
      const text = (await loadLegalText('impressum', IMPRINT_VERSION, locale))?.text ?? ''
      expect(text).toContain('Feliks Kolomoiets')
      expect(text).toContain('hello@bunprise.de')
      expect(text).not.toMatch(/<(VORNAME|FIRST NAME|STRASSE|STREET|PLZ|POSTCODE|E-MAIL|MELDE-E-MAIL|REPORT-E-MAIL)/)
      expect(text.indexOf('Feliks Kolomoiets')).toBeGreaterThan(text.indexOf(locale === 'de' ? '## Inhalte und Links' : '## Content and links'))
      expect(text).toContain(locale === 'de' ? 'Stand: 24.10.2026' : 'As of: 24 October 2026')
      expect(text).not.toContain('Kontaktformular:')
      expect(text).not.toContain('§ 5 DDG')
    }
  })

  // 6th release: pilot-6 is the current privacy notice, built from docs/legal-drafts/pilot-6 for one feature set
  // (build.mjs --on …, without inviteemail); the terms stay pilot-5 (pilot-6 has no terms); pilot-5 to pilot-1 of the
  // privacy notice stay archived unchanged.
  it.each(['de', 'en'] as const)('ships the filled pilot-6 privacy notice in %s, next to the archived pilot-5 to pilot-1', async (locale) => {
    expect(LEGAL_VERSIONS.privacy_notice).toBe('privacy-2026-10-pilot-6')
    expect(LEGAL_VERSIONS.terms).toBe('terms-2026-10-pilot-5')
    expect(hasLegalText('terms', 'terms-2026-10-pilot-6', locale)).toBe(false)
    const text = (await loadLegalText('privacy_notice', 'privacy-2026-10-pilot-6', locale))?.text ?? ''
    expect(text).toContain('Version: privacy-2026-10-pilot-6')
    expect(text).toContain(locale === 'de' ? 'Stand: 31.10.2026' : 'As of: 31 October 2026')
    expect(text).toContain('ENTWURF — vor Veröffentlichung prüfen') // both languages keep the German draft header
    expect(text).not.toContain('<') // no placeholder like <DATUM>, no HTML, no build marker <!-- FEATURE:… -->
    expect(text).not.toContain('[NEU') // the lawyer's review tags never reach the app
    expect(text).toContain('hello@bunprise.de')
    for (const older of ['pilot-5', 'pilot-4', 'pilot-3', 'pilot-2', 'pilot-1']) expect(hasLegalText('privacy_notice', `privacy-2026-10-${older}`, locale)).toBe(true)
  })

  // pilot-6 (Felix 31.10): "Anzahl" and "Passt zusammen" on, the invitation e-mail OFF (no Brevo key yet) — so the
  // published text describes the first and says nothing of the second.
  it.each(['de', 'en'] as const)('describes the quantity and linked wishes but not the invitation e-mail in the pilot-6 text in %s', async (locale) => {
    const privacy = (await loadLegalText('privacy_notice', 'privacy-2026-10-pilot-6', locale))?.text ?? ''
    expect(privacy).not.toMatch(/FEATURE:|<!--|-->/)
    expect(privacy).toContain(locale === 'de' ? 'Anzahl und „Passt zusammen“' : 'Quantity and “Goes well with”')
    expect(privacy).toContain(locale === 'de' ? '„Beides reservieren“' : '“Reserve both”')
    expect(privacy).toContain(locale === 'de' ? 'Anzahl und Verknüpfungen „Passt zusammen“: die Anzahl so lange wie der Wunsch' : 'Quantity and “Goes well with” links: the quantity as long as the wish')
    expect(privacy).toContain(locale === 'de' ? 'Listen und Wünsche (auch mit Anzahl und den Verknüpfungen „Passt zusammen“)' : 'lists and wishes (also with the quantity and the “Goes well with” links)')
    // the e-mail feature is off: no section 3.19, no mention of it (the archived pilot-5 log line names neither)
    expect(privacy).not.toContain('### 3.19')
    expect(privacy).not.toMatch(/3\.19/)
    expect(privacy).not.toContain(locale === 'de' ? 'E-Mail bei neuen Einladungen' : 'email about new invitations')
    expect(privacy).not.toContain(locale === 'de' ? 'E-Mails bei neuen Einladungen' : 'emails about new invitations')
    expect(privacy).toContain(locale === 'de' ? '„Start“; es gibt keine E-Mail; eine Push-Benachrichtigung' : '“Start”; there is no email; you only get a push notification')
    // the calendar: Google only, no .ics file any more
    expect(privacy).toContain(locale === 'de' ? '„Zu Google Kalender hinzufügen“' : '“Add to Google Calendar”')
    // the pilot-5 entry of the change log stays as it was published
    expect(privacy).toContain(locale === 'de' ? 'privacy-2026-10-pilot-5 (27.10.2026) — neu:' : 'privacy-2026-10-pilot-5 (27 October 2026) — new:')
  })

  // Whatever feature set was built: no draft or build marker is left, and the parts that are true for every set are in.
  // (pilot-6 keeps all of it: the same checks on the current privacy notice)
  it.each(['de', 'en'] as const)('describes the reservation cleanup, the calendar and Ukrainian in the pilot-5 and pilot-6 texts in %s', async (locale) => {
    const terms = (await loadLegalText('terms', 'terms-2026-10-pilot-5', locale))?.text ?? ''
    for (const version of ['privacy-2026-10-pilot-5', 'privacy-2026-10-pilot-6']) {
      const privacy = (await loadLegalText('privacy_notice', version, locale))?.text ?? ''
      for (const text of [privacy, terms]) {
        expect(text).not.toMatch(/NUR MIT DER FUNKTION|ONLY WITH THE|VERÖFFENTLICHEN:|PUBLISH ONLY/)
        expect(text).not.toMatch(/FEATURE:|<!--|-->/)
      }
      expect(privacy).toContain(locale === 'de' ? '### 3.17 Kalender' : '### 3.17 Calendar')
      expect(privacy).toContain(locale === 'de' ? 'automatische Bereinigung in der Datenbank, die jede Minute läuft' : 'automatic cleanup in the database that runs every minute')
      expect(privacy).toContain(locale === 'de' ? '„Nicht mehr verfügbar“' : '“No longer available”')
      expect(privacy).not.toContain(locale === 'de' ? 'den Grund „verschoben“' : 'the reason “moved”')
      expect(privacy).toContain(locale === 'de' ? 'Russisch oder Ukrainisch' : 'Russian or Ukrainian')
      // a section number only where the section exists (3.18 = push notifications, only with that feature)
      if (!privacy.includes('### 3.18 ')) expect(privacy).not.toMatch(/3\.18/)
    }
    expect(terms).toContain(locale === 'de' ? 'in der russischen und der ukrainischen Oberfläche' : 'in the Russian and the Ukrainian interface')
  })

  // DE and EN are kept paragraph for paragraph (docs/legal-drafts/pilot-5/README.md, pilot-6/README.md): same headings,
  // same line count — the current texts (pilot-6 privacy notice, pilot-5 terms) and the archived pilot-5 privacy notice.
  it('keeps the German and English current texts structurally identical', async () => {
    const documents = [['privacy_notice', LEGAL_VERSIONS.privacy_notice], ['terms', LEGAL_VERSIONS.terms], ['privacy_notice', 'privacy-2026-10-pilot-5']] as const
    for (const [kind, version] of documents) {
      const [de, en] = await Promise.all((['de', 'en'] as const).map(async (locale) => {
        const lines = ((await loadLegalText(kind, version, locale))?.text ?? '').split('\n').filter((line) => line.trim() !== '')
        // level and number of every heading ("## 4.", "### 3.12"); the titles differ by language
        const headings = lines.filter((line) => /^#{1,3} /.test(line)).map((line) => /^(#{1,3}) (\d+(?:\.\d+)*\.?)?/.exec(line)?.slice(1, 3).join(' '))
        return { lines: lines.length, headings }
      }))
      expect(de?.lines).toBeGreaterThan(0)
      expect(en).toEqual(de)
    }
  })
})
