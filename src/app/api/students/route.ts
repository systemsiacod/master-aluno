import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export async function GET() {
  const db = createServerClient()
  const { data, error } = await db.from('ma_students').select(`
    *,
    ma_guardians(*),
    ma_schedules(*, ma_engagement(*)),
    ma_grades(*),
    ma_recados(*)
  `).order('name')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const db = createServerClient()

  const { data, error } = await db.from('ma_students').insert({
    name: body.name,
    master_escola_login: body.login,
    master_escola_password: body.password,
    whatsapp: body.whatsapp,
    school: body.school || null,
    grade: body.grade || null,
  }).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
