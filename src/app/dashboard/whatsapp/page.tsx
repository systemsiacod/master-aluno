'use client'
import { useState, useEffect } from 'react'

export default function WhatsAppPage() {
  const [status, setStatus] = useState<'open' | 'close' | 'connecting' | null>(null)
  const [qrcode, setQrcode] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [configuring, setConfiguring] = useState(false)

  useEffect(() => { checkStatus() }, [])

  async function checkStatus() {
    setLoading(true)
    try {
      const res = await fetch('/api/whatsapp/status')
      const data = await res.json()
      setStatus(data.status)
      setQrcode(data.qrcode)
    } catch {
      setStatus('close')
    }
    setLoading(false)
  }

  async function configureWebhook() {
    setConfiguring(true)
    await fetch('/api/whatsapp/status', { method: 'POST' })
    setConfiguring(false)
    alert('Webhook configurado com sucesso!')
  }

  const statusLabel = loading ? 'Verificando...' :
    status === 'open' ? '✅ Conectado' :
    status === 'connecting' ? '🔄 Conectando...' : '❌ Desconectado'

  const dotColor = status === 'open' ? '#22c55e' : status === 'connecting' ? '#eab308' : '#ef4444'

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <h2 className="text-2xl font-bold" style={{ color: 'var(--text)' }}>WhatsApp Bot</h2>
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>Configure a conexão com a Evolution API</p>
      </div>

      {/* Status card */}
      <div className="rounded-xl border p-6 mb-4" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-3 mb-5">
          <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: dotColor }} />
          <span className="font-medium" style={{ color: 'var(--text)' }}>{statusLabel}</span>
          <button
            onClick={checkStatus}
            className="ml-auto text-xs border px-3 py-1 rounded-lg transition-colors"
            style={{ borderColor: 'var(--border)', color: 'var(--text-2)', backgroundColor: 'transparent' }}
          >
            Atualizar
          </button>
        </div>

        <div className="space-y-0">
          <InfoRow label="URL da Evolution API" value="appevoapi.iacod.com" />
          <InfoRow label="Instância" value="hugo_particular" />
          <InfoRow label="Número do Bot" value="+55 (48) 99120-7232" last />
        </div>
      </div>

      {/* QR Code */}
      {status !== 'open' && qrcode && (
        <div className="rounded-xl border p-6 mb-4 text-center" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
          <h3 className="font-semibold mb-2" style={{ color: 'var(--text)' }}>📱 Conecte o WhatsApp</h3>
          <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
            Abra o WhatsApp → Aparelhos conectados → Conectar aparelho → Escaneie o QR Code
          </p>
          <div className="inline-block border-4 rounded-xl p-2" style={{ borderColor: 'var(--border)' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrcode} alt="QR Code WhatsApp" className="w-56 h-56" />
          </div>
          <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>
            O QR Code expira em 60 segundos. Clique em &quot;Atualizar&quot; se necessário.
          </p>
        </div>
      )}

      {/* Conectado */}
      {status === 'open' && (
        <div className="rounded-xl border p-5 mb-4" style={{ backgroundColor: 'var(--badge-green-bg)', borderColor: 'var(--badge-green-fg)' }}>
          <p className="font-medium" style={{ color: 'var(--badge-green-fg)' }}>✅ WhatsApp conectado e pronto para enviar mensagens!</p>
          <p className="text-sm mt-1" style={{ color: 'var(--badge-green-fg)', opacity: 0.8 }}>
            O bot está ativo. Mensagens de alunos serão processadas automaticamente.
          </p>
        </div>
      )}

      {/* Webhook */}
      <div className="rounded-xl border p-6" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
        <h3 className="font-semibold mb-3" style={{ color: 'var(--text)' }}>⚙️ Configurações</h3>
        <button
          onClick={configureWebhook}
          disabled={configuring}
          className="w-full py-2.5 rounded-lg font-medium text-sm transition-colors disabled:opacity-50"
          style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-fg)' }}
        >
          {configuring ? 'Configurando...' : '🔗 Configurar Webhook (receber respostas)'}
        </button>
        <p className="text-xs mt-2 text-center" style={{ color: 'var(--text-muted)' }}>
          Isso conecta a Evolution API para receber as respostas dos alunos
        </p>
      </div>
    </div>
  )
}

function InfoRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <div
      className="flex justify-between py-2"
      style={{ borderBottom: last ? undefined : '1px solid var(--border)' }}
    >
      <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span className="text-xs font-mono font-medium" style={{ color: 'var(--text-2)' }}>{value}</span>
    </div>
  )
}
