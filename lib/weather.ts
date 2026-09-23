// Server-only. Importing this from a client component is a BUILD
// ERROR, not a code-review question. Calls the Google Weather API with
// a server-side key that must never reach the browser.
import 'server-only'

import { asVisitor } from '@/lib/db'
import { optionalEnv } from '@/lib/env'

/**
 * A weather tip for an event's date, for whoever is planning it.
 *
 * Google's forecast API only covers about 10 days ahead — most events
 * on this platform are booked further out than that. Rather than show
 * nothing (or worse, a fabricated "forecast" for a date no API can
 * actually predict), a date outside the real forecast window gets
 * Angola's own wet/dry season pattern instead: true regardless of date,
 * useful for planning, and honest about not being a real forecast.
 */

export interface DayForecast {
  kind: 'forecast'
  dateIso: string
  conditionLabel: string
  maxC: number
  minC: number
  rainChancePercent: number
}

export interface SeasonalOutlook {
  kind: 'seasonal'
  season: 'chuvosa' | 'seca'
  note: string
}

export type EventWeather = DayForecast | SeasonalOutlook

const FORECAST_WINDOW_DAYS = 10

// Google's weatherCondition.type enum, translated for the ones this
// climate actually produces. An unmapped type falls back to the API's
// own English description rather than showing nothing — better an
// English word than a blank line.
const CONDITION_LABEL: Record<string, string> = {
  CLEAR: 'Céu limpo',
  MOSTLY_CLEAR: 'Praticamente limpo',
  PARTLY_CLOUDY: 'Parcialmente nublado',
  MOSTLY_CLOUDY: 'Muito nublado',
  CLOUDY: 'Nublado',
  WINDY: 'Vento forte',
  WIND_AND_RAIN: 'Vento e chuva',
  LIGHT_RAIN: 'Chuva fraca',
  RAIN: 'Chuva',
  HEAVY_RAIN: 'Chuva forte',
  RAIN_SHOWERS: 'Aguaceiros',
  LIGHT_RAIN_SHOWERS: 'Aguaceiros fracos',
  HEAVY_RAIN_SHOWERS: 'Aguaceiros fortes',
  SCATTERED_SHOWERS: 'Aguaceiros dispersos',
  CHANCE_OF_SHOWERS: 'Possibilidade de aguaceiros',
  THUNDERSTORM: 'Trovoada',
  THUNDERSHOWER: 'Aguaceiros com trovoada',
  SCATTERED_THUNDERSTORMS: 'Trovoadas dispersas',
  HEAVY_THUNDERSTORM: 'Trovoada forte',
  FOG: 'Nevoeiro',
  HAZE: 'Neblina',
}

function seasonalOutlook(dateIso: string): SeasonalOutlook {
  const month = Number(dateIso.slice(5, 7))
  // Angola: época chuvosa ~Outubro-Abril, época seca ("cacimbo") ~Maio-Setembro.
  const rainy = month >= 10 || month <= 4
  return rainy
    ? {
        kind: 'seasonal',
        season: 'chuvosa',
        note: 'Esta data cai na época chuvosa em Angola (Outubro a Abril). Vale a pena ter ' +
          'um plano B coberto, mesmo para um espaço ao ar livre.',
      }
    : {
        kind: 'seasonal',
        season: 'seca',
        note: 'Esta data cai na época seca — o "cacimbo" (Maio a Setembro). Tempo tipicamente ' +
          'seco e ameno, com céu muitas vezes encoberto pela manhã.',
      }
}

function daysUntil(dateIso: string): number {
  const target = new Date(`${dateIso}T00:00:00Z`).getTime()
  const today = new Date()
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  return Math.round((target - todayUtc) / 86_400_000)
}

interface ForecastDay {
  displayDate: { year: number; month: number; day: number }
  maxTemperature?: { degrees: number }
  minTemperature?: { degrees: number }
  daytimeForecast?: {
    weatherCondition?: { type?: string; description?: { text?: string } }
    precipitation?: { probability?: { percent?: number } }
  }
}

/** providerId, not locationId — the provider is what a booking or a
 *  quote offer actually carries, and its own location already has the
 *  coordinates (0003's locations.lat/lng, populated for every real
 *  municipality — no geocoding step needed). */
export async function eventWeather(providerId: string, eventDateIso: string): Promise<EventWeather | null> {
  const daysAhead = daysUntil(eventDateIso)
  if (daysAhead < 0) return null // the date has passed — nothing to advise on
  if (daysAhead > FORECAST_WINDOW_DAYS) return seasonalOutlook(eventDateIso)

  const apiKey = optionalEnv('GOOGLE_WEATHER_API_KEY')
  if (!apiKey) return seasonalOutlook(eventDateIso)

  const coords = await asVisitor(async (c) => {
    const { rows } = await c.query<{ lat: string | null; lng: string | null }>(
      `select l.lat, l.lng from providers p join locations l on l.id = p.location_id where p.id = $1`,
      [providerId],
    )
    return rows[0] ?? null
  })
  if (!coords?.lat || !coords?.lng) return seasonalOutlook(eventDateIso)

  try {
    const url = 'https://weather.googleapis.com/v1/forecast/days:lookup' +
      `?key=${apiKey}&location.latitude=${coords.lat}&location.longitude=${coords.lng}` +
      `&days=${FORECAST_WINDOW_DAYS}&pageSize=${FORECAST_WINDOW_DAYS}`
    const response = await fetch(url, { cache: 'no-store' })
    if (!response.ok) return seasonalOutlook(eventDateIso)

    const data = (await response.json()) as { forecastDays?: ForecastDay[] }
    const day = (data.forecastDays ?? []).find((d) => {
      const { year, month, day: d2 } = d.displayDate
      return `${year}-${String(month).padStart(2, '0')}-${String(d2).padStart(2, '0')}` === eventDateIso
    })
    if (!day) return seasonalOutlook(eventDateIso)

    const condition = day.daytimeForecast?.weatherCondition
    return {
      kind: 'forecast',
      dateIso: eventDateIso,
      conditionLabel: (condition?.type && CONDITION_LABEL[condition.type])
        ?? condition?.description?.text ?? 'Sem dados',
      maxC: Math.round(day.maxTemperature?.degrees ?? 0),
      minC: Math.round(day.minTemperature?.degrees ?? 0),
      rainChancePercent: day.daytimeForecast?.precipitation?.probability?.percent ?? 0,
    }
  } catch {
    // Network failure, quota, a shape change on Google's side — an event
    // planner still gets a useful, honest note instead of a blank card.
    return seasonalOutlook(eventDateIso)
  }
}
