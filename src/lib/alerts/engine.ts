import { createServerClient } from '@/lib/supabase/server'
import { sendMessage } from '@/lib/whatsapp/evolutionApi'
import type { Student, Guardian, Schedule, Grade, Recado } from '@/types'
import { format, differenceInDays, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'

const ESCALATION_THRESHOLD = 3 // lembretes sem resposta antes de acionar responsável

export async function processNewSchedules(studentId: string, newSchedules: Schedule[]) {
  if (newSchedules.length === 0) return
  const db = createServerClient()
  const { data: student } = await db.from('ma_students').select('*').eq('id', studentId).single()
  if (!student) return

  for (const schedule of newSchedules) {
    const daysUntil = differenceInDays(parseISO(schedule.date), new Date())
    const dateFormatted = format(parseISO(schedule.date), "dd/MM (EEEE)", { locale: ptBR })
    const emoji = schedule.type === 'AVALIAÇÃO' ? '📝' : schedule.type === 'TRABALHO' ? '📋' : '✏️'

    const msg = `${emoji} *Novo agendamento, ${student.name.split(' ')[0]}!*\n\n` +
      `*${schedule.type}* — ${schedule.discipline}\n` +
      `📅 ${dateFormatted}\n` +
      `📌 ${schedule.title}\n\n` +
      `${daysUntil <= 0 ? '⚠️ É hoje!' : daysUntil === 1 ? '⚠️ É amanhã!' : `Faltam ${daysUntil} dias.`}\n\n` +
      `Já se organizou para isso? Responda *SIM* ou *NÃO*.`

    await sendMessage(student.whatsapp, msg)
    await db.from('ma_alert_logs').insert({
      student_id: studentId,
      alert_type: 'new_schedule',
      recipient_phone: student.whatsapp,
      message: msg,
      related_id: schedule.id,
    })

    // Cria registro de engajamento
    await db.from('ma_engagement').upsert({
      student_id: studentId,
      schedule_id: schedule.id,
      reminders_sent: 1,
      last_reminder_at: new Date().toISOString(),
    }, { onConflict: 'student_id,schedule_id' })
  }
}

export async function sendDailyReminders(studentId: string) {
  const db = createServerClient()
  const { data: student } = await db.from('ma_students').select('*').eq('id', studentId).single()
  if (!student) return

  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  // Busca agendamentos dos próximos 3 dias não concluídos
  const { data: upcoming } = await db
    .from('ma_schedules')
    .select('*, engagement(*)')
    .eq('student_id', studentId)
    .eq('completed', false)
    .gte('date', today.toISOString().split('T')[0])
    .lte('date', new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
    .order('date', { ascending: true })

  if (!upcoming || upcoming.length === 0) return

  for (const schedule of upcoming) {
    const daysUntil = differenceInDays(parseISO(schedule.date), today)
    const engagementData = Array.isArray(schedule.engagement) ? schedule.engagement[0] : schedule.engagement

    // Só lembra se ainda não confirmou
    if (engagementData?.student_confirmed_done) continue

    const emoji = schedule.type === 'AVALIAÇÃO' ? '📝' : schedule.type === 'TRABALHO' ? '📋' : '✏️'
    let urgencyText = ''
    if (daysUntil === 0) urgencyText = '🔴 *É HOJE!*'
    else if (daysUntil === 1) urgencyText = '🟠 *É AMANHÃ!*'
    else urgencyText = `🟡 Faltam ${daysUntil} dias`

    const msg = `${emoji} *Lembrete — ${schedule.type}*\n\n` +
      `${urgencyText}\n` +
      `📚 ${schedule.discipline}: ${schedule.title}\n\n` +
      `Você já se preparou? Responda:\n` +
      `✅ *SIM* — já me organizei\n` +
      `❌ *NÃO* — ainda não fiz\n` +
      `✔️ *PRONTO* — já entreguei/fiz`

    await sendMessage(student.whatsapp, msg)

    // Atualiza engajamento
    const currentReminders = engagementData?.reminders_sent || 0
    const newCount = currentReminders + 1

    await db.from('ma_engagement').upsert({
      student_id: studentId,
      schedule_id: schedule.id,
      reminders_sent: newCount,
      last_reminder_at: new Date().toISOString(),
    }, { onConflict: 'student_id,schedule_id' })

    await db.from('ma_alert_logs').insert({
      student_id: studentId,
      alert_type: 'daily_reminder',
      recipient_phone: student.whatsapp,
      message: msg,
      related_id: schedule.id,
    })

    // Verifica se deve escalar para responsável
    if (newCount >= ESCALATION_THRESHOLD && !engagementData?.escalated_to_guardian) {
      await escalateToGuardians(student, schedule, newCount)
      await db.from('ma_engagement').update({ escalated_to_guardian: true })
        .eq('student_id', studentId)
        .eq('schedule_id', schedule.id)
    }
  }
}

export async function processStudentReply(studentPhone: string, replyText: string) {
  const db = createServerClient()
  const normalizedPhone = studentPhone.replace(/\D/g, '').replace(/^55/, '')

  const { data: student } = await db
    .from('ma_students')
    .select('*')
    .ilike('whatsapp', `%${normalizedPhone}%`)
    .single()

  if (!student) return

  const reply = replyText.trim().toUpperCase()
  const isPositive = ['SIM', 'S', 'JÁ', 'JA', 'PRONTO', 'OK', '✅', 'FEITO', 'FIZ'].some(w => reply.includes(w))
  const isNegative = ['NÃO', 'NAO', 'N', 'AINDA NÃO', 'AINDA NAO', '❌'].some(w => reply.includes(w))

  // Registra resposta
  await db.from('ma_whatsapp_messages').insert({
    student_id: student.id,
    direction: 'received',
    phone: studentPhone,
    message: replyText,
    context_type: 'schedule_reply',
  })

  if (isPositive) {
    // Marca o engajamento mais recente como respondido
    await db.from('ma_engagement')
      .update({ student_responded: true, student_confirmed_done: true, updated_at: new Date().toISOString() })
      .eq('student_id', student.id)
      .eq('student_confirmed_done', false)

    const msg = `🎉 Ótimo, ${student.name.split(' ')[0]}! Continue assim — organização é tudo! 💪`
    await sendMessage(student.whatsapp, msg)

    // Avisa responsável que aluno se organizou
    await notifyGuardiansPositive(student)
  } else if (isNegative) {
    await db.from('ma_engagement')
      .update({ student_responded: true, updated_at: new Date().toISOString() })
      .eq('student_id', student.id)

    const msg = `Tudo bem! Que tal separar um tempo agora? Cada pouquinho já ajuda. 📚\nMe avisa quando terminar! ✅`
    await sendMessage(student.whatsapp, msg)
  } else {
    const msg = `Recebi sua mensagem! 😊\nSe quiser atualizar seu status de tarefas, responda *SIM* (já fiz) ou *NÃO* (ainda não).`
    await sendMessage(student.whatsapp, msg)
  }
}

export async function processNewRecados(studentId: string, newRecados: Recado[]) {
  if (newRecados.length === 0) return
  const db = createServerClient()

  const { data: student } = await db.from('ma_students').select('*').eq('id', studentId).single()
  if (!student) return
  const { data: guardians } = await db.from('ma_guardians')
    .select('*').eq('student_id', studentId).eq('active', true).eq('notify_recados', true)

  for (const recado of newRecados) {
    const content = recado.content.slice(0, 500)

    // Envia para o aluno
    const studentMsg = `📢 *Novo recado da escola!*\n\n${content}\n\n_Leia com atenção e avise seus responsáveis se necessário._`
    await sendMessage(student.whatsapp, studentMsg)

    // Envia para responsáveis habilitados
    for (const guardian of (guardians || [])) {
      const guardianMsg = `📢 *Recado da escola — ${student.name.split(' ')[0]}*\n\n${content}`
      await sendMessage(guardian.whatsapp, guardianMsg)
      await db.from('ma_alert_logs').insert({
        student_id: studentId,
        guardian_id: guardian.id,
        alert_type: 'new_recado',
        recipient_phone: guardian.whatsapp,
        message: guardianMsg,
        related_id: recado.id,
      })
    }
  }
}

export async function processGradeChanges(studentId: string, newGrades: Grade[]) {
  if (newGrades.length === 0) return
  const db = createServerClient()

  const { data: student } = await db.from('ma_students').select('*').eq('id', studentId).single()
  if (!student) return
  const { data: guardians } = await db.from('ma_guardians')
    .select('*').eq('student_id', studentId).eq('active', true).eq('notify_grades', true)

  for (const grade of newGrades) {
    if (grade.grade === null) continue
    const emoji = grade.grade >= 8 ? '🌟' : grade.grade >= 6 ? '👍' : '⚠️'
    const msg = `${emoji} *Nova nota — ${grade.discipline}*\n\nNota: *${grade.grade}* (${grade.classification})\n`

    // Alerta de nota baixa
    const isLow = grade.grade < 6
    const lowGuardians = isLow
      ? (guardians || []).filter((g: Guardian) => g.notify_low_grades)
      : (guardians || []).filter((g: Guardian) => g.notify_grades)

    for (const guardian of lowGuardians) {
      const extra = isLow ? `\n⚠️ Nota abaixo da média em ${grade.discipline}. Verifique com ${student.name.split(' ')[0]}.` : ''
      await sendMessage(guardian.whatsapp, msg + extra)
    }
  }
}

export async function sendWeeklySummary(studentId: string) {
  const db = createServerClient()
  const { data: student } = await db.from('ma_students').select('*').eq('id', studentId).single()
  if (!student) return

  const { data: guardians } = await db.from('ma_guardians')
    .select('*').eq('student_id', studentId).eq('active', true).eq('notify_weekly_summary', true)
  if (!guardians || guardians.length === 0) return

  const nextWeek = new Date()
  nextWeek.setDate(nextWeek.getDate() + 7)

  const { data: upcoming } = await db.from('ma_schedules')
    .select('*')
    .eq('student_id', studentId)
    .eq('completed', false)
    .gte('date', new Date().toISOString().split('T')[0])
    .lte('date', nextWeek.toISOString().split('T')[0])
    .order('date', { ascending: true })

  const { data: grades } = await db.from('ma_grades').select('*').eq('student_id', studentId)

  const { data: engagements } = await db.from('ma_engagement')
    .select('*').eq('student_id', studentId)

  const totalEngagements = engagements?.length || 0
  const responded = engagements?.filter(e => e.student_responded).length || 0
  const engagementRate = totalEngagements > 0 ? Math.round((responded / totalEngagements) * 100) : 0

  const upcomingLines = (upcoming || []).slice(0, 5).map(s => {
    const d = format(parseISO(s.date), 'dd/MM (EEE)', { locale: ptBR })
    return `  • ${d} — ${s.type}: ${s.discipline}`
  }).join('\n')

  const gradesLine = (grades || []).map(g => `  • ${g.discipline}: ${g.grade} (${g.classification})`).join('\n')

  const msg = `📊 *Resumo Semanal — ${student.name.split(' ')[0]}*\n\n` +
    `🏫 ${student.school || 'Escola'} — ${student.grade || ''}\n\n` +
    (upcomingLines ? `📅 *Próximos agendamentos:*\n${upcomingLines}\n\n` : `📅 Sem agendamentos esta semana.\n\n`) +
    (gradesLine ? `📊 *Notas recentes:*\n${gradesLine}\n\n` : '') +
    `🤝 *Engajamento:* ${engagementRate}% dos lembretes respondidos\n\n` +
    `_Relatório automático do Master Aluno_ 🎓`

  for (const guardian of guardians) {
    await sendMessage(guardian.whatsapp, msg)
  }
}

async function escalateToGuardians(student: Student, schedule: Schedule, reminderCount: number) {
  const db = createServerClient()
  const { data: guardians } = await db.from('ma_guardians')
    .select('*').eq('student_id', student.id).eq('active', true).eq('notify_escalation', true)
  if (!guardians || guardians.length === 0) return

  const emoji = schedule.type === 'AVALIAÇÃO' ? '📝' : '📋'
  const dateFormatted = format(parseISO(schedule.date), "dd/MM/yyyy", { locale: ptBR })

  const msg = `⚠️ *Alerta — ${student.name.split(' ')[0]} não respondeu*\n\n` +
    `Enviamos ${reminderCount} lembretes sobre:\n` +
    `${emoji} ${schedule.type}: ${schedule.title}\n` +
    `📚 ${schedule.discipline} — ${dateFormatted}\n\n` +
    `${student.name.split(' ')[0]} ainda não confirmou que se organizou. Pode verificar?`

  for (const guardian of guardians) {
    await sendMessage(guardian.whatsapp, msg)
    await db.from('ma_alert_logs').insert({
      student_id: student.id,
      guardian_id: guardian.id,
      alert_type: 'escalation',
      recipient_phone: guardian.whatsapp,
      message: msg,
      related_id: schedule.id,
    })
  }
}

async function notifyGuardiansPositive(student: Student) {
  const db = createServerClient()
  const { data: guardians } = await db.from('ma_guardians')
    .select('*').eq('student_id', student.id).eq('active', true).eq('notify_escalation', true)

  for (const guardian of (guardians || [])) {
    const msg = `✅ *${student.name.split(' ')[0]} confirmou!*\n\nEle(a) respondeu que já se organizou com as tarefas. 🎉`
    await sendMessage(guardian.whatsapp, msg)
  }
}
