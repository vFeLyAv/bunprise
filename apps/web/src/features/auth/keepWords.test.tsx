import { expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { keepWords } from './keepWords'

// QA ACCOUNT-12: "E-Mail" never splits at its hyphen at a line end; the text itself stays the same
it('keeps every "E-Mail" on one line without changing the text', () => {
  const text = 'Es wird keine E-Mail verschickt. Nutze deine E-Mail-Adresse.'
  const { container } = render(<p>{keepWords(text)}</p>)
  expect(container.textContent).toBe(text)
  const kept = container.querySelectorAll('span.whitespace-nowrap')
  expect([...kept].map((span) => span.textContent)).toEqual(['E-Mail', 'E-Mail'])
})

it('leaves other text as plain text', () => {
  expect(keepWords('No email is sent.')).toBe('No email is sent.')
})
