import { requireAdmin } from '../../../lib/supabase/server';
import CheckInClient, { CheckInClass } from './CheckInClient';

function todaySydney() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export default async function CheckInPage() {
  const { supabase } = await requireAdmin();
  const today = todaySydney();

  const { data: classes, error: classError } = await supabase
    .from('classes')
    .select('id,name,term,location,day_of_week,start_time,end_time')
    .eq('active', true)
    .order('name');

  if (classError) throw classError;

  const classIds = (classes ?? []).map((c) => c.id);

  const { data: enrolments, error: enrolmentError } = classIds.length
    ? await supabase
        .from('enrolments')
        .select('id,class_id,student_id,status,profiles!enrolments_student_id_fkey(first_name,last_name)')
        .in('class_id', classIds)
        .in('status', ['enrolled','suspended'])
    : { data: [], error: null };

  if (enrolmentError) throw enrolmentError;

  const { data: sessions, error: sessionError } = classIds.length
    ? await supabase
        .from('class_sessions')
        .select('id,class_id,session_date,cancelled')
        .in('class_id', classIds)
        .eq('session_date', today)
    : { data: [], error: null };

  if (sessionError) throw sessionError;

  const sessionByClass = new Map((sessions ?? []).map((s:any) => [s.class_id, s]));
  const sessionIds = (sessions ?? []).map((s:any) => s.id);

  const { data: attendance, error: attendanceError } = sessionIds.length
    ? await supabase
        .from('attendance')
        .select('enrolment_id,session_id,status,checked_in_at')
        .in('session_id', sessionIds)
    : { data: [], error: null };

  if (attendanceError) throw attendanceError;

  const attendanceByEnrolment = new Map((attendance ?? []).map((a:any) => [a.enrolment_id, a]));

  const rows: CheckInClass[] = (classes ?? []).map((classRow:any) => {
    const session:any = sessionByClass.get(classRow.id);
    return {
      id: classRow.id,
      name: [classRow.name, classRow.term].filter(Boolean).join(' — '),
      location: classRow.location ?? '',
      startTime: classRow.start_time ? String(classRow.start_time).slice(0,5) : '',
      endTime: classRow.end_time ? String(classRow.end_time).slice(0,5) : '',
      sessionId: session?.id ?? null,
      sessionCancelled: Boolean(session?.cancelled),
      students: (enrolments ?? [])
        .filter((e:any) => e.class_id === classRow.id)
        .map((e:any) => {
          const record:any = attendanceByEnrolment.get(e.id);
          return {
            enrolmentId: e.id,
            studentId: e.student_id,
            name: `${e.profiles?.first_name ?? ''} ${e.profiles?.last_name ?? ''}`.trim() || 'Student',
            enrolmentStatus: e.status,
            attendanceStatus: record?.status ?? null,
            checkedInAt: record?.checked_in_at ?? null,
          };
        })
        .sort((a:any,b:any) => a.name.localeCompare(b.name)),
    };
  });

  return <CheckInClient classes={rows} today={today} />;
}
