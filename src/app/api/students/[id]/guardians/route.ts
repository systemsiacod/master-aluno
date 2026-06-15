import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = createServerClient()
  const { data, error } = await db.from('ma_guardians').select('*').eq('student_id', id).order('name')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()
  const db = createServerClient()

  const { data, error } = await db.from('ma_guardians').insert({
    student_id: id,
    name: body.name,
    relationship: body.relationship,
    whatsapp: body.whatsapp,
    notify_recados: body.notify_recados ?? true,
    notify_grades: body.notify_grades ?? true,
    notify_low_grades: body.notify_low_grades ?? true,
    notify_escalation: body.notify_escalation ?? true,
    notify_weekly_summary: body.notify_weekly_summary ?? true,
  }).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
