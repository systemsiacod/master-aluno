import axios from 'axios'

const API_URL = process.env.EVOLUTION_API_URL!
const API_KEY = process.env.EVOLUTION_API_KEY!
const INSTANCE = process.env.EVOLUTION_INSTANCE_NAME || 'hugo_particular'

const client = axios.create({
  baseURL: API_URL,
  headers: {
    apikey: API_KEY,
    'Content-Type': 'application/json',
  },
  timeout: 15000,
})

export async function ensureInstance() {
  try {
    const { data } = await client.get(`/instance/fetchInstances`)
    const instances = Array.isArray(data) ? data : []
    const exists = instances.find((i: { instance?: { instanceName?: string } }) => i.instance?.instanceName === INSTANCE)
    if (!exists) {
      await client.post('/instance/create', {
        instanceName: INSTANCE,
        qrcode: true,
        integration: 'WHATSAPP-BAILEYS',
      })
    }
    return true
  } catch (err) {
    console.error('[Evolution] Erro ao verificar instância:', err)
    return false
  }
}

export async function getQRCode(): Promise<string | null> {
  try {
    const { data } = await client.get(`/instance/connect/${INSTANCE}`)
    return data?.base64 || data?.qrcode?.base64 || null
  } catch {
    return null
  }
}

export async function getConnectionStatus(): Promise<'open' | 'close' | 'connecting'> {
  try {
    const { data } = await client.get(`/instance/connectionState/${INSTANCE}`)
    return data?.instance?.state || 'close'
  } catch {
    return 'close'
  }
}

export async function sendMessage(phone: string, message: string): Promise<string | null> {
  try {
    const number = formatPhone(phone)
    const { data } = await client.post(`/message/sendText/${INSTANCE}`, {
      number,
      text: message,
    })
    return data?.key?.id || data?.messageId || null
  } catch (err) {
    console.error(`[Evolution] Erro ao enviar para ${phone}:`, err)
    return null
  }
}

export async function setWebhook(webhookUrl: string) {
  try {
    await client.post(`/webhook/set/${INSTANCE}`, {
      webhook: {
        enabled: true,
        url: webhookUrl,
        webhookByEvents: false,
        webhookBase64: false,
        events: ['MESSAGES_UPSERT'],
      },
    })
    return true
  } catch (err) {
    console.error('[Evolution] Erro ao configurar webhook:', err)
    return false
  }
}

function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  // Garante formato com código do país
  if (digits.startsWith('55')) return `${digits}@s.whatsapp.net`
  return `55${digits}@s.whatsapp.net`
}
