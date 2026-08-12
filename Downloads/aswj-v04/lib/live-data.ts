import { applications as demoApplications, reviewStudents as demoReviewStudents, dashboardMetrics as demoDashboardMetrics } from './demo-data';
import { hasSupabaseConfig, requireAdmin } from './supabase/server';

export type ApplicationRow = { id:string; name:string; className:string; submitted:string; status:string };
export type ReviewRow = { id:string; enrolmentId?:string; name:string; className:string; missed:number; lastAttended:string; attendance:string; status:string };

function titleStatus(v: string) {
  return v ? v.charAt(0).toUpperCase() + v.slice(1).replaceAll('_',' ') : v;
}

export async function getApplications(): Promise<ApplicationRow[]> {
  if (!hasSupabaseConfig()) return [...demoApplications];
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase
    .from('applications')
    .select('id,status,submitted_at,profiles!applications_student_id_fkey(first_name,last_name),classes(name,term)')
    .order('submitted_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []).map((row:any) => ({
    id: row.id,
    name: `${row.profiles?.first_name ?? ''} ${row.profiles?.last_name ?? ''}`.trim() || 'Unnamed student',
    className: [row.classes?.name, row.classes?.term].filter(Boolean).join(' — '),
    submitted: new Date(row.submitted_at).toLocaleDateString('en-AU', { day:'numeric', month:'short', year:'numeric' }),
    status: titleStatus(row.status),
  }));
}

export async function getAttendanceReviews(): Promise<ReviewRow[]> {
  if (!hasSupabaseConfig()) return [...demoReviewStudents];
  const { supabase } = await requireAdmin();
  const { error: materializeError } = await supabase.rpc('open_required_suspension_reviews');
  if (materializeError) throw materializeError;
  const { data, error } = await supabase
    .from('students_requiring_attendance_review')
    .select('enrolment_id,student_id,class_id,consecutive_absences,absence_threshold')
    .order('consecutive_absences', { ascending: false });
  if (error) throw error;

  const rows: ReviewRow[] = [];
  for (const row of data ?? []) {
    const { data: enrolment, error: enrolmentError } = await supabase
      .from('enrolments')
      .select('id,student_id,class_id,profiles!enrolments_student_id_fkey(first_name,last_name),classes!enrolments_class_id_fkey(name,term)')
      .eq('id', (row as any).enrolment_id)
      .single();
    if (enrolmentError || !enrolment) continue;
    const e:any = enrolment;

    const { data: attendance } = await supabase
      .from('attendance')
      .select('status,class_sessions!attendance_session_id_fkey(session_date)')
      .eq('enrolment_id', (row as any).enrolment_id);
    const records:any[] = (attendance ?? []).sort((a:any,b:any) =>
      String(b.class_sessions?.session_date ?? '').localeCompare(String(a.class_sessions?.session_date ?? ''))
    );
    const total = records.filter(r => r.status !== 'cancelled').length;
    const attended = records.filter(r => ['present','late'].includes(r.status)).length;
    const last = records.find(r => ['present','late'].includes(r.status));
    rows.push({
      id: String((row as any).student_id),
      enrolmentId: String((row as any).enrolment_id),
      name: `${e?.profiles?.first_name ?? ''} ${e?.profiles?.last_name ?? ''}`.trim() || 'Unnamed student',
      className: [e?.classes?.name, e?.classes?.term].filter(Boolean).join(' — '),
      missed: Number((row as any).consecutive_absences ?? 0),
      lastAttended: last?.class_sessions?.session_date ? new Date(last.class_sessions.session_date+'T00:00:00').toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric'}) : 'No attendance recorded',
      attendance: total ? `${Math.round(attended / total * 100)}%` : '—',
      status: 'Review required',
    });
  }
  return rows;
}

export async function getDashboardMetrics() {
  if (!hasSupabaseConfig()) return demoDashboardMetrics;
  const { supabase } = await requireAdmin();
  const [pending, waitlist, suspended, activeStudents, reviews] = await Promise.all([
    supabase.from('applications').select('id',{count:'exact',head:true}).eq('status','pending'),
    supabase.from('applications').select('id',{count:'exact',head:true}).eq('status','waitlisted'),
    supabase.from('enrolments').select('id',{count:'exact',head:true}).eq('status','suspended'),
    supabase.from('enrolments').select('student_id',{count:'exact',head:true}).eq('status','enrolled'),
    supabase.from('students_requiring_attendance_review').select('enrolment_id',{count:'exact',head:true}),
  ]);
  return [
    ['Pending applications', String(pending.count ?? 0), ''],
    ['Waiting list', String(waitlist.count ?? 0), ''],
    ['3+ absences — review', String(reviews.count ?? 0), 'metric-danger'],
    ['Suspended enrolments', String(suspended.count ?? 0), 'metric-danger'],
    ['Active enrolments', String(activeStudents.count ?? 0), ''],
  ] as const;
}
