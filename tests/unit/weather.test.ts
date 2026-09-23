import { afterEach, describe, expect, it } from 'vitest'
import { eventWeather } from '@/lib/weather'

/**
 * The three branches that need neither a database nor a network call:
 * a past date, a date beyond the ~10-day forecast window, and a missing
 * API key. All three return before touching either — the real-forecast
 * branch is verified live instead (see spec/slices/21-weather-and-tips.md).
 */

const originalKey = process.env.GOOGLE_WEATHER_API_KEY

afterEach(() => {
  if (originalKey === undefined) delete process.env.GOOGLE_WEATHER_API_KEY
  else process.env.GOOGLE_WEATHER_API_KEY = originalKey
})

function isoDaysFromNow(days: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

describe('eventWeather', () => {
  it('returns null for a date that has already passed', async () => {
    expect(await eventWeather('provider-1', '2000-01-01')).toBeNull()
  })

  it('falls back to a seasonal outlook beyond the forecast window', async () => {
    const result = await eventWeather('provider-1', isoDaysFromNow(60))
    expect(result?.kind).toBe('seasonal')
  })

  it('calls a December date "chuvosa" and a July date "seca"', async () => {
    const december = await eventWeather('provider-1', '2027-12-15')
    const july = await eventWeather('provider-1', '2027-07-15')
    expect(december?.kind).toBe('seasonal')
    expect(july?.kind).toBe('seasonal')
    if (december?.kind === 'seasonal') expect(december.season).toBe('chuvosa')
    if (july?.kind === 'seasonal') expect(july.season).toBe('seca')
  })

  it('falls back to seasonal, even within the forecast window, when no API key is configured', async () => {
    delete process.env.GOOGLE_WEATHER_API_KEY
    const result = await eventWeather('provider-1', isoDaysFromNow(2))
    expect(result?.kind).toBe('seasonal')
  })
})
