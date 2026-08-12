import { requireAdmin } from '../../../lib/supabase/server';
import StudentsClient, { StudentAdminRow } from './StudentsClient';

export default async function StudentsPage() {
  const { supabase } = await requireAdmin();

  const { data: profiles, error: profileError } = await supabase
    .from('profiles')
    .select('id,first_name,last_name,email,mobile,date_of_birth,emergency_contact_name,emergency_contact_mobile,role,created_at')
    .eq('role', 'student')
    .order('first_name');

  if (profileError) throw profileError;

  const studentIds = (profiles ?? []).map((p) => p.id);

  const { data: enrolments, error: enrolmentError } = studentIds.length
    ? await supabase
        .from('enrolments')
        .select('id,student_id,class_id,status,enrolled_at,suspended_at,suspension_reason,classes!enrolments_class_id_fkey(name,term,location)')
        .in('student_id', studentIds)
        .order('enrolled_at', { ascending: false })
    : { data: [], error: null };

  if (enrolmentError) throw enrolmentError;

  const enrolmentIds = (enrolments ?? []).map((e:any) => e.id);

  const { data: attendance, error: attendanceError } = enrolmentIds.length
    ? await supabase
        .from('attendance')
        .select('enrolment_id,status')
        .in('enrolment_id', enrolmentIds)
    : { data: [], error: null };

  if (attendanceError) throw attendanceError;

  const byStudent = new Map<string, any[]>();
  for (const e of enrolments ?? []) {
    const list = byStudent.get((e as any).student_id) ?? [];
    list.push(e);
    byStudent.set((e as any).student_id, list);
  }

  const attendanceByEnrolment = new Map<string, any[]>();
  for (const a of attendance ?? []) {
    const list = attendanceByEnrolment.get((a as any).enrolment_id) ?? [];
    list.push(a);
    attendanceByEnrolment.set((a as any).enrolment_id, list);
  }

  const rows: StudentAdminRow[] = (profiles ?? []).map((profile:any) => {
    const studentEnrolments = byStudent.get(profile.id) ?? [];
    const activeEnrolments = studentEnrolments.filter((e:any) => ['enrolled', 'suspended'].includes(e.status));

    let total = 0;
    let attended = 0;

    for (const enrolment of activeEnrolments) {
      const records = attendanceByEnrolment.get(enrolment.id) ?? [];
      total += records.filter((r:any) => r.status !== 'cancelled').length;
      attended += records.filter((r:any) => ['present', 'late'].includes(r.status)).length;
    }

    return {
      id: profile.id,
      firstName: profile.first_name ?? '',
      lastName: profile.last_name ?? '',
      name: `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || 'Unnamed student',
      email: profile.email ?? '',
      mobile: profile.mobile ?? '',
      dateOfBirth: profile.date_of_birth ?? null,
      emergencyContactName: profile.emergency_contact_name ?? '',
      emergencyContactMobile: profile.emergency_contact_mobile ?? '',
      createdAt: profile.created_at,
      attendanceRate: total ? Math.round((attended / total) * 100) : null,
      enrolments: studentEnrolments.map((e:any) => ({
        id: e.id,
        status: e.status,
        enrolledAt: e.enrolled_at,
        suspendedAt: e.suspended_at,
        suspensionReason: e.suspension_reason,
        className: [e.classes?.name, e.classes?.term].filter(Boolean).join(' — ') || 'Unknown class',
        location: e.classes?.location ?? '',
      })),
    };
  });

  return <StudentsClient rows={rows} />;
}
