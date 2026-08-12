'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '../../../lib/supabase/server';

export async function suspendEnrolment(enrolmentId: string, reason: string, note: string, notifyStudent = true) {
  const { supabase, user } = await requireAdmin();
  const now = new Date().toISOString();

  const { data: enrolment, error: readError } = await supabase
    .from('enrolments')
    .select('id, student_id, class_id, status')
    .eq('id', enrolmentId)
    .single();
  if (readError || !enrolment) throw new Error('Enrolment not found.');
  if (enrolment.status !== 'enrolled') throw new Error('Only an enrolled student can be suspended.');

  const { error: updateError } = await supabase.from('enrolments').update({
    status: 'suspended',
    suspended_at: now,
    suspension_reason: reason,
    suspended_by: user.id,
  }).eq('id', enrolmentId);
  if (updateError) throw updateError;

  await supabase.from('suspension_reviews').update({
    status: 'suspended', reviewed_by: user.id, reviewed_at: now, review_note: note || null,
  }).eq('enrolment_id', enrolmentId).eq('status', 'open');

  await supabase.from('audit_log').insert({
    actor_id: user.id,
    entity_type: 'enrolment',
    entity_id: enrolmentId,
    action: 'student_suspended',
    old_values: { status: enrolment.status },
    new_values: { status: 'suspended', reason, note: note || null },
  });

  if (notifyStudent) {
    await supabase.from('notifications').insert({
      student_id: enrolment.student_id,
      enrolment_id: enrolmentId,
      channel: 'portal',
      template_key: 'enrolment_suspended',
      status: 'queued',
    });
  }

  revalidatePath('/admin');
  revalidatePath('/admin/attendance-review');
  revalidatePath('/admin/students');
  revalidatePath('/student');
}

export async function resolveAttendanceReview(enrolmentId: string, resolution: 'excused' | 'kept_enrolled', note?: string) {
  const { supabase, user } = await requireAdmin();
  const { error } = await supabase.from('suspension_reviews').update({
    status: resolution,
    reviewed_by: user.id,
    reviewed_at: new Date().toISOString(),
    review_note: note || null,
  }).eq('enrolment_id', enrolmentId).eq('status', 'open');
  if (error) throw error;

  await supabase.from('audit_log').insert({
    actor_id: user.id,
    entity_type: 'enrolment',
    entity_id: enrolmentId,
    action: `attendance_review_${resolution}`,
    new_values: { note: note || null },
  });

  revalidatePath('/admin');
  revalidatePath('/admin/attendance-review');
}

export async function reinstateEnrolment(enrolmentId: string, note?: string) {
  const { supabase, user } = await requireAdmin();
  const now = new Date().toISOString();
  const { data: enrolment, error: readError } = await supabase
    .from('enrolments')
    .select('id, student_id, class_id, status')
    .eq('id', enrolmentId)
    .single();
  if (readError || !enrolment) throw new Error('Enrolment not found.');

  const { error } = await supabase.from('enrolments').update({
    status: 'enrolled',
    reinstated_at: now,
    reinstated_by: user.id,
  }).eq('id', enrolmentId);
  if (error) throw error;

  await supabase.from('audit_log').insert({
    actor_id: user.id,
    entity_type: 'enrolment',
    entity_id: enrolmentId,
    action: 'student_reinstated',
    old_values: { status: enrolment.status },
    new_values: { status: 'enrolled', note: note || null },
  });

  revalidatePath('/admin');
  revalidatePath('/admin/attendance-review');
  revalidatePath('/admin/students');
  revalidatePath('/student');
}
