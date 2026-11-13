import { describe, expect, it } from 'vitest'
import seedSql from '../../../../supabase/migrations/20261019120300_legal_versions_seed.sql?raw'
import pilot5Sql from '../../../../supabase/migrations/20261027220000_legal_versions_pilot_5.sql?raw'
import pilot6Sql from '../../../../supabase/migrations/20261031120000_legal_versions_pilot_6.sql?raw'
import { LEGAL_VERSIONS } from '../lib/legal'
import { CONSENT_KINDS, missingConsents, versionsFromMe } from '../lib/api/consents'
import type { Me } from '../lib/api/types'

// LEGAL_VERSIONS (apps/web) must mirror the version migrations (pilot-decisions §1): privacy_notice comes from the
// newest version migration (pilot-6, 6th release; built per feature set), terms from pilot-5 (pilot-6 has no terms),
// age_18plus from the seed.

describe('legal versions', () => {
  it('mirror the newest migration row of every kind', () => {
    expect(pilot6Sql).toMatch(new RegExp(`\\('privacy_notice',\\s*'${LEGAL_VERSIONS.privacy_notice}'\\)`))
    // the terms did not change with pilot-6: still the pilot-5 row, untouched by the pilot-6 migration
    expect(pilot5Sql).toMatch(new RegExp(`\\('terms',\\s*'${LEGAL_VERSIONS.terms}'\\)`))
    expect(pilot6Sql).not.toMatch(/'terms'/)
    // age_18plus did not change with pilot-2 to pilot-6: still the seeded row, untouched by those migrations
    expect(seedSql).toMatch(new RegExp(`\\('age_18plus',\\s*'${LEGAL_VERSIONS.age_18plus}'\\)`))
    expect(pilot5Sql).not.toMatch(/'age_18plus'/)
    expect(pilot6Sql).not.toMatch(/'age_18plus'/)
  })

  it('records a privacy notice separately from terms/age and maps the existing RPC wire key', () => {
    expect(CONSENT_KINDS).toEqual(['terms', 'privacy_notice', 'age_18plus'])
    const versions = versionsFromMe({ legal_versions: { terms: 'terms-new', privacy: 'notice-new', age: 'age-new' } } as Me)
    expect(versions).toEqual({ terms: 'terms-new', privacy_notice: 'notice-new', age_18plus: 'age-new' })
    expect(missingConsents(versions, [])).toEqual(['terms', 'privacy_notice', 'age_18plus'])
  })
})
