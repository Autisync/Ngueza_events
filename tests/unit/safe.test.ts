import { describe, expect, it } from 'vitest'
import {
  calendarDate, firstParam, intInRange, jsonForScript, normalizePhone, safeNext,
  todayInLuanda, uuidOrUndefined, whatsappUrl,
} from '@/lib/safe'

describe('jsonForScript', () => {
  it('cannot close the surrounding <script>', () => {
    const out = jsonForScript({ description: '</script><script>alert(1)</script>' })
    expect(out).not.toContain('<')
    expect(out).not.toContain('>')
    expect(JSON.parse(out).description).toBe('</script><script>alert(1)</script>')
  })
  it('escapes & and the JS line separators, and round-trips', () => {
    const v = { a: 'x & y', b: 'p\u2028q\u2029r' }
    const out = jsonForScript(v)
    expect(out).not.toMatch(/[&\u2028\u2029]/)
    expect(JSON.parse(out)).toEqual(v)
  })
})

describe('safeNext', () => {
  it('keeps same-origin paths', () => {
    expect(safeNext('/fornecedor/x#reservar')).toBe('/fornecedor/x#reservar')
    expect(safeNext('/procurar?data=2026-12-15')).toBe('/procurar?data=2026-12-15')
  })
  it.each(['//evil.example', '/\\evil.example', 'https://evil.example', '/\t/evil.example',
    'javascript:alert(1)', '', undefined, 42])('rejects %s', (raw) => {
    expect(safeNext(raw)).toBe('/conta')
  })
  it('uses the given fallback', () => {
    expect(safeNext('//x', '/')).toBe('/')
  })
})

describe('normalizePhone', () => {
  it.each([
    ['923 456 789', '+244923456789'],
    ['923456789', '+244923456789'],
    ['+244 923 456 789', '+244923456789'],
    ['244923456789', '+244923456789'],
    ['00244923456789', '+244923456789'],
    ['+351 912 345 678', '+351912345678'],
  ])('%s → %s', (raw, e164) => {
    expect(normalizePhone(raw)).toBe(e164)
  })
  it.each(['', '   ', '12', 'abc', '+244 92345', '9234567890123456', null])('rejects %s', (raw) => {
    expect(normalizePhone(raw)).toBeNull()
  })
  it('builds wa.me links without the plus', () => {
    expect(whatsappUrl('+244923456789')).toBe('https://wa.me/244923456789')
    // A prefilled message, encoded so '&' or '?' in it cannot break the link.
    expect(whatsappUrl('+244923456789', 'Olá! Ref. A&B? 15/12')).toBe('https://wa.me/244923456789?text=Ol%C3%A1!%20Ref.%20A%26B%3F%2015%2F12')
  })
})

describe('URL params', () => {
  it('takes the first of a repeated key', () => {
    expect(firstParam(['a', 'b'])).toBe('a')
  })
  it('accepts only real uuids', () => {
    expect(uuidOrUndefined('talatona')).toBeUndefined()
    expect(uuidOrUndefined('------------------------------------')).toBeUndefined()
    expect(uuidOrUndefined('1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed')).toBe('1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed')
  })
  it('accepts only real calendar dates', () => {
    expect(calendarDate('2026-12-15')).toBe('2026-12-15')
    expect(calendarDate('2026-02-31')).toBeUndefined()
    expect(calendarDate('2026-13-01')).toBeUndefined()
    expect(calendarDate('15/12/2026')).toBeUndefined()
  })
  it('bounds integers', () => {
    expect(intInRange('200', 1, 100000)).toBe(200)
    expect(intInRange('0', 1, 100000)).toBeUndefined()
    expect(intInRange('99999999999', 1, 100000)).toBeUndefined()
    expect(intInRange('-5', 1, 100000)).toBeUndefined()
    expect(intInRange('2.5', 1, 100000)).toBeUndefined()
  })
})

describe('todayInLuanda', () => {
  it('is UTC+1: 23:30 UTC is already tomorrow in Luanda', () => {
    expect(todayInLuanda(new Date('2026-12-14T23:30:00Z'))).toBe('2026-12-15')
    expect(todayInLuanda(new Date('2026-12-14T22:30:00Z'))).toBe('2026-12-14')
  })
})
