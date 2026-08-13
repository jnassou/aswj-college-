import { requireAdmin } from '../../../lib/supabase/server';
import ClassesClient, { ClassRow, TeacherOption } from './ClassesClient';

export default async function ClassesPage() {
  const { supabase } = await requireAdmin();

  const [
    { data: classData, error: classError },
    { data: enrolmentData, error: enrolmentError },
    { data: teacherData, error: teacherError },
  ] = await Promise.all([
    supabase
      .from('classes')
      .select('id,name,term,teacher_id,location,capacity,absence_threshold,registration_enabled,registration_opens_at,registration_closes_at,starts_on,ends_on,day_of_week,start_time,end_time,active')
      .order('active', { ascending: false })
      .order('name'),
    supabase
      .from('enrolments')
      .select('class_id,status')
      .in('status', ['enrolled', 'suspended']),
    supabase
      .from('profiles')
      .select('id,first_name,last_name,role')
      .in('role', ['teacher', 'admin', 'super_admin'])
      .order('first_name'),
  ]);

  if (classError) throw classError;
  if (enrolmentError) throw enrolmentError;
  if (teacherError) throw teacherError;

  const counts = new Map<string, number>();
  for (const enrolment of enrolmentData ?? []) {
    counts.set(enrolment.class_id, (counts.get(enrolment.class_id) ?? 0) + 1);
  }

  const teacherNames = new Map<string, string>();
  const teachers: TeacherOption[] = (teacherData ?? []).map((teacher) => {
    const name = `${teacher.first_name ?? ''} ${teacher.last_name ?? ''}`.trim() || 'Staff member';
    teacherNames.set(teacher.id, name);
    return { id: teacher.id, name, role: teacher.role };
  });

  const rows: ClassRow[] = (classData ?? []).map((row) => ({
    ...row,
    enrolled: counts.get(row.id) ?? 0,
    teacher_name: row.teacher_id ? teacherNames.get(row.teacher_id) ?? 'Assigned staff' : null,
  }));

  return <ClassesClient rows={rows} teachers={teachers} />;
}
