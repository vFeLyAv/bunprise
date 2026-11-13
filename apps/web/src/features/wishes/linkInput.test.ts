import { describe, expect, it } from 'vitest'
import { extractLink, hostOf, shopLetter, shouldAutoRead } from './linkInput'

describe('extractLink (what a paste into the link field becomes)', () => {
  it('finds the link inside chat text and drops what ends the sentence', () => {
    expect(extractLink('Schau mal: https://www.shop.example/kopfhoerer-wh9?farbe=schwarz 😍')).toBe(
      'https://www.shop.example/kopfhoerer-wh9?farbe=schwarz',
    )
    expect(extractLink('Das hier → https://shop.example/teekanne.')).toBe('https://shop.example/teekanne')
    expect(extractLink('(siehe https://shop.example/a_(b))')).toBe('https://shop.example/a_(b)')
    expect(extractLink('„https://shop.example/x“')).toBe('https://shop.example/x')
  })

  it('takes a bare shop address and adds https://', () => {
    expect(extractLink('shop.example/kopfhoerer')).toBe('https://shop.example/kopfhoerer')
    expect(extractLink('www.shop.example')).toBe('https://www.shop.example/')
    expect(extractLink('  teekanne.example/produkte/blau  ')).toBe('https://teekanne.example/produkte/blau')
  })

  it('finds nothing in plain words, e-mail addresses or other schemes', () => {
    for (const text of ['', '   ', 'Kopfhörer', 'z. B. Sony', 'mila@example.test', 'javascript:alert(1)', 'ftp://shop.example/x', 'data:text/html,hi']) {
      expect(extractLink(text), text).toBeNull()
    }
  })

  it('never returns a link over 2048 characters (the database limit)', () => {
    expect(extractLink(`https://shop.example/${'a'.repeat(2100)}`)).toBeNull()
  })
})

describe('shouldAutoRead (typed text is read without Enter only when it clearly is a whole link)', () => {
  it('reads a link with a scheme, a www. address or a host with a path', () => {
    for (const text of ['https://shop.example', 'http://shop.example/x', 'www.shop.example', 'shop.example/kopfhoerer']) {
      expect(shouldAutoRead(text), text).toBe(true)
    }
  })

  it('waits while a bare host is still being typed and never reads sentences', () => {
    for (const text of ['amazon.d', 'shop.example', 'shop.example/', 'Schau mal https://shop.example/x', 'kopfhörer']) {
      expect(shouldAutoRead(text), text).toBe(false)
    }
  })
})

describe('shop chip helpers', () => {
  it('hostOf drops www.; shopLetter takes the first letter or digit, upper-case', () => {
    expect(hostOf('https://www.Shop.Example/a')).toBe('shop.example')
    expect(hostOf('kein link')).toBe('')
    expect(shopLetter('shop.example')).toBe('S')
    expect(shopLetter('www.thalia.de')).toBe('T')
    expect(shopLetter('ökoladen.example')).toBe('Ö')
    expect(shopLetter('24h-shop.example')).toBe('2')
    expect(shopLetter('...')).toBe('')
  })
})
