'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '../../../lib/supabase/server';

type Decision = 'accepted' | 'waitlisted' | 'declined';

export async function decideApplication(applicationId: string, decision: Decision, note?: string) {
  const { supabase, user } = await requireAdmin();

  const { data: application, error: readError } = await supabase
    .from('applications')
    .select('id, student_id, class_id, status')
    .eq('id', applicationId)
    .single();
  if (readError || !application) throw new Error('Application not found.');

  const oldStatus = application.status;
  const update: Record<string, unknown> = {
    status: decision,
    reviewed_by: user.id,
    reviewed_at: new Date().toISOString(),
    admin_notes: note || null,
  };

  if (decision === 'waitlisted') {
    const { count } = await supabase
      .from('applications')
      .select('id', { count: 'exact', head: true })
      .eq('class_id', application.class_id)
      .eq('status', 'waitlisted');
    update.waitlist_position = (count ?? 0) + 1;
  } else {
    update.waitlist_position = null;
  }

  const { error: updateError } = await supabase
    .from('applications')
    .update(update)
    .eq('id', applicationId);
  if (updateError) throw updateError;

  if (decision === 'accepted') {
    const { error: enrolError } = await supabase.from('enrolments').upsert({
      student_id: application.student_id,
      class_id: application.class_id,
      application_id: application.id,
      status: 'enrolled',
    }, { onConflict: 'student_id,class_id' });
    if (enrolError) throw enrolError;
  }

  await supabase.from('audit_log').insert({
    actor_id: user.id,
    entity_type: 'application',
    entity_id: applicationId,
    action: `application_${decision}`,
    old_values: { status: oldStatus },
    new_values: { status: decision, note: note || null },
  });

  await supabase.from('notifications').insert({
    student_id: application.student_id,
    channel: 'portal',
    template_key: `application_${decision}`,
    status: 'queued',
  });

  revalidatePath('/admin');
  revalidatePath('/admin/applications');
}
