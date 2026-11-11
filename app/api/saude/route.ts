import { NextResponse } from 'next/server'
import { jobHealth } from '@/lib/jobs'

export const dynamic = 'force-dynamic'

/**
 * Health for an external uptime monitor (slice 34). 200 when the database
 * answers, both scheduled jobs have succeeded recently and email is going
 * out; 503 otherwise, naming which check failed — so the monitor's alert
 * already says where to look.
 *
 * Public on purpose: a monitor has no session. It reveals only job names
 * and how long ago they last succeeded, nothing about any booking or
 * person.
 */
export async function GET(): Promise<NextResponse> {
  const headers = { 'cache-control': 'no-store' }
  try {
    const checks = await jobHealth()
    const ok = checks.every((c) => c.healthy)
    return NextResponse.json(
      { ok, checks: checks.map(({ check, healthy, detail }) => ({ check, healthy, detail })) },
      { status: ok ? 200 : 503, headers },
    )
  } catch {
    return NextResponse.json(
      { ok: false, checks: [{ check: 'database', healthy: false, detail: 'sem resposta' }] },
      { status: 503, headers },
    )
  }
}
