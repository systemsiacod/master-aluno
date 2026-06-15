import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { scrapeMasterEscola } from '@/lib/scraper/masterEscola'
import { processNewSchedules, processNewRecados, processGradeChanges } from '@/lib/alerts/engine'

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret')
  const body = await req.json().catch(() => ({}))
  const studentId: string | undefined = body.studentId

  if (secret !== process.env.CRON_SECRET && !studentId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createServerClient()
  const query = db.from('ma_students').select('*').eq('active', true)
  if (studentId) query.eq('id', studentId)

  const { data: students, error } = await query
  if (error || !students?.length) {
    return NextResponse.json({ error: 'Nenhum aluno encontrado' }, { status: 404 })
  }

  const results = []

  for (const student of students) {
    try {
      console.log(`[Scraper] Processando aluno: ${student.name}`)
      const scraped = await scrapeMasterEscola(student.master_escola_login, student.master_escola_password)

      // --- AGENDAMENTOS ---
      const newSchedules = []
      for (const s of scraped.schedules) {
        const { data: existing } = await db.from('ma_schedules')
          .select('id').eq('student_id', student.id).eq('external_key', s.external_key).single()

        if (!existing) {
          const { data: inserted } = await db.from('ma_schedules').insert({
            ...s, student_id: student.id,
          }).select().single()
          if (inserted) newSchedules.push(inserted)
        } else {
          // Atualiza status completed se mudou
          await db.from('ma_schedules').update({ completed: s.completed })
            .eq('student_id', student.id).eq('external_key', s.external_key)
        }
      }
      if (newSchedules.length > 0) await processNewSchedules(student.id, newSchedules)

      // --- RECADOS ---
      const newRecados = []
      for (const r of scraped.recados) {
        if (!r.external_key) continue
        const { data: existing } = await db.from('ma_recados')
          .select('id').eq('student_id', student.id).eq('external_key', r.external_key).single()
        if (!existing) {
          const { data: inserted } = await db.from('ma_recados').insert({
            ...r, student_id: student.id,
          }).select().single()
          if (inserted) newRecados.push(inserted)
        }
      }
      if (newRecados.length > 0) await processNewRecados(student.id, newRecados)

      // --- NOTAS ---
      const changedGrades = []
      for (const g of scraped.grades) {
        if (!g.discipline) continue
        const { data: existing } = await db.from('ma_grades')
          .select('*').eq('student_id', student.id).eq('discipline', g.discipline).eq('semester', g.semester).single()
        if (!existing) {
          const { data: inserted } = await db.from('ma_grades').insert({
            ...g, student_id: student.id,
          }).select().single()
          if (inserted) changedGrades.push(inserted)
        } else if (existing.grade !== g.grade) {
          await db.from('ma_grades').update({ grade: g.grade, classification: g.classification, scraped_at: new Date().toISOString() })
            .eq('id', existing.id)
          changedGrades.push({ ...existing, ...g })
        }
      }
      if (changedGrades.length > 0) await processGradeChanges(student.id, changedGrades)

      // Atualiza timestamp
      await db.from('ma_students').update({ last_scraped_at: new Date().toISOString() }).eq('id', student.id)

      results.push({ student: student.name, success: true, newSchedules: newSchedules.length, newRecados: newRecados.length, changedGrades: changedGrades.length })
    } catch (err) {
      console.error(`[Scraper] Erro no aluno ${student.name}:`, err)
      results.push({ student: student.name, success: false, error: String(err) })
    }
  }

  return NextResponse.json({ results })
}
