'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '../../../lib/supabase/server';

export type ApplicationDecision = 'accepted' | 'waitlisted' | 'declined';

export async function decideApplication(
  applicationId: string,
  decision: ApplicationDecision,
  note?: string
) {
  const { supabase } = await requireAdmin();
  const { error } = await supabase.rpc('admin_decide_application', {
    p_application_id: applicationId,
    p_decision: decision,
    p_note: note?.trim() || null,
  });

  if (error) throw new Error(error.message);

  revalidatePath('/admin/applications');
  revalidatePath('/admin');
  revalidatePath('/admin/students');
  revalidatePath('/admin/classes');
  revalidatePath('/student');
}
