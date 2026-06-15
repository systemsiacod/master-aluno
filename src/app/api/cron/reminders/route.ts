import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { sendDailyReminders } from '@/lib/alerts/engine'

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret')
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createServerClient()
  const { data: students } = await db.from('ma_students').select('id, name').eq('active', true)

  const results = []
  for (const student of (students || [])) {
    try {
      await sendDailyReminders(student.id)
      results.push({ student: student.name, success: true })
    } catch (err) {
      results.push({ student: student.name, success: false, error: String(err) })
    }
  }

  return NextResponse.json({ results, timestamp: new Date().toISOString() })
}
