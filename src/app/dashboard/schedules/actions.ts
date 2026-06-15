'use server'
import { createServerClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function toggleScheduleCompleted(id: string, completed: boolean) {
  const db = createServerClient()
  await db.from('ma_schedules').update({
    completed,
    completed_at: completed ? new Date().toISOString() : null,
  }).eq('id', id)
  revalidatePath('/dashboard/schedules')
}
