import { expect, it } from 'vitest'
import { toAppError } from '../../lib/errors'
import de from '../../locales/de/errors.json'
import en from '../../locales/en/errors.json'
import ru from '../../locales/ru/errors.json'
import uk from '../../locales/uk/errors.json'

it.each(['invalid_credentials', 'otp_expired'])('%s never invents an attempts counter', (code) => {
  const error = toAppError({ __isAuthError: true, code, status: 400, message: 'fixture' })
  expect(error.code).toBe('code_invalid')
  expect(error.params).toBeUndefined()
  expect(de.errors.code_invalid).toBe('Der Code stimmt nicht oder ist abgelaufen – prüf ihn oder fordere einen neuen an')
  for (const strings of [de.errors, en.errors, ru.errors, uk.errors]) {
    for (const key of ['code_wrong', 'code_wrong_one', 'code_wrong_other', 'code_expired', 'code_invalid'] as const) {
      expect(strings[key]).not.toMatch(/\{\{count\}\}|\d|Versuch|attempt|попыт|спроб/i)
    }
  }
  for (const key of ['code_wrong_few', 'code_wrong_many'] as const) {
    expect(ru.errors[key]).not.toMatch(/\{\{count\}\}|\d|попыт/i)
    expect(uk.errors[key]).not.toMatch(/\{\{count\}\}|\d|спроб/i)
  }
})
