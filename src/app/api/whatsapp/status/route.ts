import { NextResponse } from 'next/server'
import { ensureInstance, getQRCode, getConnectionStatus, setWebhook } from '@/lib/whatsapp/evolutionApi'

export async function GET() {
  await ensureInstance()
  const status = await getConnectionStatus()
  let qrcode = null
  if (status !== 'open') {
    qrcode = await getQRCode()
  }
  return NextResponse.json({ status, qrcode })
}

export async function POST() {
  await ensureInstance()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const webhookUrl = `${appUrl}/api/whatsapp/webhook`
  const ok = await setWebhook(webhookUrl)
  return NextResponse.json({ ok, webhookUrl })
}
