import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import './globals.css'
import { ThemeProvider } from '@/components/ThemeProvider'

const geist = Geist({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Master Aluno',
  description: 'Monitoramento escolar inteligente com alertas via WhatsApp',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className="h-full" data-theme="light" suppressHydrationWarning>
      <body className={`${geist.className} h-full`}>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}
