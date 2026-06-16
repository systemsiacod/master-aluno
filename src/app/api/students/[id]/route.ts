import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await req.json()
  const db = createServerClient()

  const updateData: Record<string, unknown> = {
    name: body.name,
    master_escola_login: body.login,
    whatsapp: body.whatsapp,
    school: body.school || null,
    grade: body.grade || null,
    updated_at: new Date().toISOString(),
  }

  // Só atualiza a senha se uma nova foi fornecida
  if (body.password && body.password.trim() !== '') {
    updateData.master_escola_password = body.password
  }

  const { data, error } = await db
    .from('ma_students')
    .update(updateData)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
