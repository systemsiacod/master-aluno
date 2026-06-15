import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { processStudentReply } from '@/lib/alerts/engine'

interface EvolutionWebhookPayload {
  event: string
  instance: string
  data?: {
    key?: { remoteJid?: string; fromMe?: boolean; id?: string }
    message?: { conversation?: string; extendedTextMessage?: { text?: string } }
    messageType?: string
  }
}

export async function POST(req: NextRequest) {
  try {
    const payload: EvolutionWebhookPayload = await req.json()

    // Só processa mensagens recebidas
    if (payload.event !== 'messages.upsert') return NextResponse.json({ ok: true })
    const data = payload.data
    if (!data || data.key?.fromMe) return NextResponse.json({ ok: true })

    const phone = data.key?.remoteJid?.replace('@s.whatsapp.net', '') || ''
    const text = data.message?.conversation || data.message?.extendedTextMessage?.text || ''

    if (!phone || !text) return NextResponse.json({ ok: true })

    // Salva mensagem recebida
    const db = createServerClient()
    await db.from('ma_whatsapp_messages').insert({
      direction: 'received',
      phone,
      message: text,
      whatsapp_message_id: data.key?.id,
    })

    // Processa resposta do aluno
    await processStudentReply(phone, text)

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[Webhook] Erro:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
