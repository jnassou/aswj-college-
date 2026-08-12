'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '../../../lib/supabase/server';

export type ApplicationDecision = 'accepted' | 'waitlisted' | 'declined';

export async function decideApplication(
  applicationId: string,
  decision: ApplicationDecision,
  note?: string
) {
  const { supabase, user } = await requireAdmin();

  const { data: application, error: readError } = await supabase
    .from('applications')
    .select('id,student_id,class_id,status,waitlist_position')
    .eq('id', applicationId)
    .single();

  if (readError || !application) throw new Error('Application not found.');

  if (decision === 'accepted') {
    const [{ data: classRow, error: classError }, { count, error: countError }] = await Promise.all([
      supabase
        .from('classes')
        .select('id,name,capacity,active')
        .eq('id', application.class_id)
        .single(),
      supabase
        .from('enrolments')
        .select('id', { count: 'exact', head: true })
        .eq('class_id', application.class_id)
        .in('status', ['enrolled', 'suspended']),
    ]);

    if (classError || !classRow) throw new Error('Class not found.');
    if (!classRow.active) throw new Error('This class is archived and cannot accept new students.');
    if ((count ?? 0) >= classRow.capacity) {
      throw new Error(`${classRow.name} is full. Put this student on the waiting list instead.`);
    }
  }

  let waitlistPosition: number | null = null;
  if (decision === 'waitlisted') {
    const { data: positions, error: waitError } = await supabase
      .from('applications')
      .select('waitlist_position')
      .eq('class_id', application.class_id)
      .eq('status', 'waitlisted')
      .order('waitlist_position', { ascending: false })
      .limit(1);

    if (waitError) throw waitError;
    waitlistPosition = Number(positions?.[0]?.waitlist_position ?? 0) + 1;
  }

  const now = new Date().toISOString();
  const update = {
    status: decision,
    waitlist_position: waitlistPosition,
    reviewed_by: user.id,
    reviewed_at: now,
    admin_notes: note?.trim() || null,
  };

  const { error: updateError } = await supabase
    .from('applications')
    .update(update)
    .eq('id', applicationId);

  if (updateError) throw updateError;

  if (decision === 'accepted') {
    const { error: enrolError } = await supabase
      .from('enrolments')
      .upsert(
        {
          student_id: application.student_id,
          class_id: application.class_id,
          application_id: application.id,
          status: 'enrolled',
        },
        { onConflict: 'student_id,class_id' }
      );

    if (enrolError) throw enrolError;
  } else if (application.status === 'accepted') {
    const { error: removeError } = await supabase
      .from('enrolments')
      .delete()
      .eq('application_id', application.id);

    if (removeError) throw removeError;
  }

  await supabase.from('audit_log').insert({
    actor_id: user.id,
    entity_type: 'application',
    entity_id: applicationId,
    action: `application_${decision}`,
    old_values: {
      status: application.status,
      waitlist_position: application.waitlist_position,
    },
    new_values: update,
  });

  await supabase.from('notifications').insert({
    student_id: application.student_id,
    channel: 'portal',
    template_key: `application_${decision}`,
    status: 'queued',
  });

  revalidatePath('/admin/applications');
  revalidatePath('/admin');
  revalidatePath('/admin/students');
  revalidatePath('/admin/classes');
}
