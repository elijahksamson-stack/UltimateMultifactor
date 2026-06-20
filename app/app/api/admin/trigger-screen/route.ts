import { NextRequest, NextResponse } from 'next/server'
import { inngest } from '@/inngest/client'
import { isAuthorized } from '@/lib/http/adminAuth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  if (!isAuthorized(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const targetDate = req.nextUrl.searchParams.get('date') ?? undefined
  await inngest.send({ name: 'screen/run.trigger', data: { targetDate } })
  return NextResponse.json({ ok: true, triggered: targetDate ?? 'today' })
}
