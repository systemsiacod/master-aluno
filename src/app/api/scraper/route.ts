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
  let query = db.from('ma_students').select('*').eq('active', true)
  if (studentId) query = query.eq('id', studentId)

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
          const { data: inserted, error: insertErr } = await db.from('ma_schedules').insert({
            ...s, student_id: student.id,
          }).select().single()
          if (insertErr) console.error(`[Scraper] ❌ Erro ao inserir agendamento "${s.title}":`, insertErr.message)
          else if (inserted) newSchedules.push(inserted)
        } else {
          await db.from('ma_schedules').update({ completed: s.completed, description: s.description })
            .eq('student_id', student.id).eq('external_key', s.external_key)
        }
      }
      console.log(`[Scraper] 📅 Agendamentos: ${scraped.schedules.length} lidos, ${newSchedules.length} novos inseridos`)
      if (newSchedules.length > 0) await processNewSchedules(student.id, newSchedules)

      // --- RECADOS ---
      // Dedup: compara pelo external_key = ID numérico do sistema legado (Master Escola).
      // Recados já existentes são ignorados; novos são inseridos.
      const newRecados = []
      let skippedRecados = 0
      for (const r of scraped.recados) {
        if (!r.external_key) continue
        const { data: existing } = await db.from('ma_recados')
          .select('id').eq('student_id', student.id).eq('external_key', r.external_key).single()
        if (existing) {
          skippedRecados++
          continue  // já existe no Master Aluno — pula
        }
        const { data: inserted, error: insertErr } = await db.from('ma_recados').insert({
          ...r, student_id: student.id,
        }).select().single()
        if (insertErr) console.error(`[Scraper] ❌ Erro ao inserir recado "${r.title}":`, insertErr.message)
        else if (inserted) newRecados.push(inserted)
      }
      console.log(`[Scraper] 📢 Recados: ${scraped.recados.length} lidos do Master Escola | ${skippedRecados} já existiam | ${newRecados.length} novos inseridos`)
      if (newRecados.length > 0) await processNewRecados(student.id, newRecados)

      // --- AUTO-AGENDAMENTOS a partir de RECADOS com datas ou cronogramas ---
      // Regra A: recado com keyword + datas no texto → cria entrada por data
      // Regra B: recado com "cronograma" + sem datas → cria 1 entrada placeholder para lembrar de verificar
      let autoScheduleCount = 0
      const SCHED_KEYWORDS = /cronograma|prova|avalia|simulado|trabalho|entrega|prazo|apresenta|bimestral|reapresenta/i

      for (const r of scraped.recados) {
        const text = [r.title, r.content].filter(Boolean).join(' ')
        if (!SCHED_KEYWORDS.test(text)) continue

        const dateMatches = [...text.matchAll(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/g)]

        if (dateMatches.length > 0) {
          // Regra A: tem datas explícitas
          for (const m of dateMatches) {
            const [, d, mo, y] = m
            const year = y.length === 2 ? `20${y}` : y
            const isoDate = `${year}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
            const dateObj = new Date(isoDate)
            if (isNaN(dateObj.getTime()) || dateObj.getFullYear() < 2024) continue

            const rawType = text.toUpperCase()
            const type: 'AVALIAÇÃO' | 'TRABALHO' | 'ATIVIDADE' =
              /PROVA|AVALIA|SIMULADO|CRONOGRAMA/.test(rawType) ? 'AVALIAÇÃO' :
              /TRABALHO|ENTREGA/.test(rawType) ? 'TRABALHO' : 'ATIVIDADE'

            const extKey = `recado-${r.external_key}-${isoDate}`
            const { data: existSched } = await db.from('ma_schedules')
              .select('id').eq('student_id', student.id).eq('external_key', extKey).single()

            if (!existSched) {
              const { error: schedErr } = await db.from('ma_schedules').insert({
                student_id: student.id,
                external_key: extKey,
                date: isoDate,
                type,
                title: (r.title || text.slice(0, 100)).slice(0, 200),
                description: `Auto-criado do recado (ID ${r.external_key}): ${(r.title || r.content).slice(0, 150)}`,
                discipline: '',
                completed: false,
                completed_at: null,
              })
              if (!schedErr) {
                autoScheduleCount++
                console.log(`[Scraper] 📅 Auto-agendamento (data encontrada): "${r.title || 'recado'}" → ${isoDate}`)
              }
            }
          }
        } else if (/cronograma/i.test(text) && r.attachment_url) {
          // Regra B: é um cronograma com anexo mas sem datas no texto
          // Cria 1 entrada placeholder para lembrar de verificar o anexo
          const extKey = `recado-cronograma-${r.external_key}`
          const { data: existSched } = await db.from('ma_schedules')
            .select('id').eq('student_id', student.id).eq('external_key', extKey).single()

          if (!existSched) {
            // Usa a data de envio do recado como referência
            const refDate = r.sent_at_iso || new Date().toISOString().slice(0, 10)
            const { error: schedErr } = await db.from('ma_schedules').insert({
              student_id: student.id,
              external_key: extKey,
              date: refDate,
              type: 'AVALIAÇÃO',
              title: (r.title || 'Cronograma de Provas').slice(0, 200),
              description: `📎 Verificar datas no anexo: ${r.attachment_url?.slice(0, 200) || ''}`,
              discipline: '',
              completed: false,
              completed_at: null,
            })
            if (!schedErr) {
              autoScheduleCount++
              console.log(`[Scraper] 📅 Auto-agendamento (cronograma/anexo): "${r.title || 'recado'}" → verificar datas no anexo`)
            }
          }
        }
      }
      if (autoScheduleCount > 0)
        console.log(`[Scraper] ✨ ${autoScheduleCount} agendamentos criados automaticamente de recados`)

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
