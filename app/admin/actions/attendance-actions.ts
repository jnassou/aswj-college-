'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '../../../lib/supabase/server';

function refreshAttendanceViews() {
  revalidatePath('/admin');
  revalidatePath('/admin/attendance-review');
  revalidatePath('/admin/students');
  revalidatePath('/student');
}

export async function suspendEnrolment(
  enrolmentId: string,
  reason: string,
  note: string,
  notifyStudent = true
) {
  const { supabase } = await requireAdmin();
  const { error } = await supabase.rpc('admin_suspend_enrolment', {
    p_enrolment_id: enrolmentId,
    p_reason: reason,
    p_note: note.trim() || null,
    p_notify_student: notifyStudent,
  });

  if (error) throw new Error(error.message);
  refreshAttendanceViews();
}

export async function resolveAttendanceReview(
  enrolmentId: string,
  resolution: 'excused' | 'kept_enrolled',
  note?: string
) {
  const { supabase } = await requireAdmin();
  const { error } = await supabase.rpc('admin_resolve_attendance_review', {
    p_enrolment_id: enrolmentId,
    p_resolution: resolution,
    p_note: note?.trim() || null,
  });

  if (error) throw new Error(error.message);
  refreshAttendanceViews();
}

export async function reinstateEnrolment(enrolmentId: string, note?: string) {
  const { supabase } = await requireAdmin();
  const { error } = await supabase.rpc('admin_reinstate_enrolment', {
    p_enrolment_id: enrolmentId,
    p_note: note?.trim() || null,
  });

  if (error) throw new Error(error.message);
  refreshAttendanceViews();
}
