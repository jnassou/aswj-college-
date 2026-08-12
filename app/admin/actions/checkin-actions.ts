'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '../../../lib/supabase/server';

function todaySydney() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export async function ensureTodaySession(classId: string) {
  const { supabase } = await requireAdmin();
  const today = todaySydney();

  const { data: existing, error: readError } = await supabase
    .from('class_sessions')
    .select('id,class_id,session_date,starts_at,ends_at,cancelled')
    .eq('class_id', classId)
    .eq('session_date', today)
    .maybeSingle();

  if (readError) throw readError;
  if (existing) return existing;

  const { data: classRow, error: classError } = await supabase
    .from('classes')
    .select('id,start_time,end_time,active')
    .eq('id', classId)
    .single();

  if (classError || !classRow) throw new Error('Class not found.');
  if (!classRow.active) throw new Error('This class is archived.');

  const startsAt = classRow.start_time ? `${today}T${String(classRow.start_time).slice(0,8)}+10:00` : null;
  const endsAt = classRow.end_time ? `${today}T${String(classRow.end_time).slice(0,8)}+10:00` : null;

  const { data, error } = await supabase
    .from('class_sessions')
    .insert({
      class_id: classId,
      session_date: today,
      starts_at: startsAt,
      ends_at: endsAt,
      cancelled: false,
    })
    .select('id,class_id,session_date,starts_at,ends_at,cancelled')
    .single();

  if (error) throw error;
  return data;
}

export async function checkInByQr(classId: string, token: string) {
  const { supabase, user } = await requireAdmin();
  const cleaned = token.trim().replace(/^aswj:/i, '');

  if (!cleaned) throw new Error('No QR token was supplied.');

  const session = await ensureTodaySession(classId);
  if (session.cancelled) throw new Error('Today’s class session is cancelled.');

  const { data: qrRow, error: qrError } = await supabase
    .from('student_qr_tokens')
    .select('student_id,active')
    .eq('token', cleaned)
    .eq('active', true)
    .maybeSingle();

  if (qrError) throw qrError;
  if (!qrRow) throw new Error('This QR code is not valid or has been revoked.');

  const { data: enrolment, error: enrolmentError } = await supabase
    .from('enrolments')
    .select('id,status,profiles!enrolments_student_id_fkey(first_name,last_name)')
    .eq('student_id', qrRow.student_id)
    .eq('class_id', classId)
    .maybeSingle();

  if (enrolmentError) throw enrolmentError;
  if (!enrolment) throw new Error('This student is not enrolled in the selected class.');
  if (enrolment.status === 'suspended') throw new Error('This student is currently suspended from this class.');
  if (enrolment.status !== 'enrolled') throw new Error('This enrolment is not active.');

  const now = new Date().toISOString();
  const { error: attendanceError } = await supabase
    .from('attendance')
    .upsert({
      enrolment_id: enrolment.id,
      session_id: session.id,
      status: 'present',
      checked_in_at: now,
      checkin_method: 'qr',
      recorded_by: user.id,
      updated_at: now,
    }, { onConflict: 'enrolment_id,session_id' });

  if (attendanceError) throw attendanceError;

  await supabase.from('audit_log').insert({
    actor_id: user.id,
    entity_type: 'attendance',
    entity_id: enrolment.id,
    action: 'qr_checkin',
    new_values: {
      session_id: session.id,
      class_id: classId,
      student_id: qrRow.student_id,
      checked_in_at: now,
    },
  });

  revalidatePath('/admin/check-in');
  revalidatePath('/admin/attendance-review');
  revalidatePath('/admin/students');
  revalidatePath('/student');

  const profile:any = enrolment.profiles;
  return {
    studentId: qrRow.student_id,
    name: `${profile?.first_name ?? ''} ${profile?.last_name ?? ''}`.trim() || 'Student',
    checkedInAt: now,
  };
}

export async function setManualAttendance(
  enrolmentId: string,
  classId: string,
  status: 'present' | 'late' | 'absent' | 'excused'
) {
  const { supabase, user } = await requireAdmin();
  const session = await ensureTodaySession(classId);
  const now = new Date().toISOString();

  const { error } = await supabase
    .from('attendance')
    .upsert({
      enrolment_id: enrolmentId,
      session_id: session.id,
      status,
      checked_in_at: ['present','late'].includes(status) ? now : null,
      checkin_method: 'manual',
      recorded_by: user.id,
      updated_at: now,
    }, { onConflict: 'enrolment_id,session_id' });

  if (error) throw error;

  await supabase.from('audit_log').insert({
    actor_id: user.id,
    entity_type: 'attendance',
    entity_id: enrolmentId,
    action: 'manual_attendance',
    new_values: { class_id: classId, session_id: session.id, status },
  });

  revalidatePath('/admin/check-in');
  revalidatePath('/admin/attendance-review');
  revalidatePath('/admin/students');
  revalidatePath('/student');
}
