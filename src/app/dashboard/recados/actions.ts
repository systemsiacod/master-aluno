'use server'
import { createServerClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function toggleRecadoRead(id: string, read: boolean) {
  const db = createServerClient()
  await db.from('ma_recados').update({
    read,
    read_at: read ? new Date().toISOString() : null,
  }).eq('id', id)
  revalidatePath('/dashboard/recados')
}
