'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '../../../lib/supabase/server';

function refreshAttendanceViews() {
  revalidatePath('/admin');
  revalidatePath('/admin/check-in');
  revalidatePath('/admin/attendance-review');
  revalidatePath('/admin/students');
  revalidatePath('/student');
}

export async function checkInByQr(classId: string, token: string) {
  const { supabase } = await requireAdmin();
  const cleaned = token.trim().replace(/^aswj:/i, '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cleaned)) {
    throw new Error('This QR code is not valid.');
  }

  const { data, error } = await supabase.rpc('admin_check_in_by_qr', {
    p_class_id: classId,
    p_token: cleaned,
  });

  if (error) throw new Error(error.message);
  refreshAttendanceViews();

  const row = Array.isArray(data) ? data[0] : data;
  return { name: row?.student_name ?? 'Student' };
}

export async function setManualAttendance(
  enrolmentId: string,
  classId: string,
  status: 'present' | 'late' | 'absent' | 'excused' | 'absent_unexcused' | 'absent_excused'
) {
  const { supabase } = await requireAdmin();
  const databaseStatus = status === 'absent'
    ? 'absent_unexcused'
    : status === 'excused'
      ? 'absent_excused'
      : status;

  const { error } = await supabase.rpc('admin_set_manual_attendance', {
    p_enrolment_id: enrolmentId,
    p_class_id: classId,
    p_status: databaseStatus,
  });

  if (error) throw new Error(error.message);
  refreshAttendanceViews();
}

export async function closeTodayRoll(classId: string) {
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase.rpc('admin_close_today_roll', {
    p_class_id: classId,
  });

  if (error) throw new Error(error.message);
  refreshAttendanceViews();
  return { markedAbsent: Number(data ?? 0) };
}
