import { requireAdmin } from '../../../lib/supabase/server';
import ApplicationsClient, { ApplicationAdminRow } from './ApplicationsClient';

export default async function ApplicationsPage() {
  const { supabase } = await requireAdmin();

  const { data, error } = await supabase
    .from('applications')
    .select(`
      id,
      status,
      waitlist_position,
      source,
      external_response_id,
      submitted_at,
      reviewed_at,
      profiles!applications_student_id_fkey(
        id,
        first_name,
        last_name,
        email,
        mobile,
        date_of_birth,
        emergency_contact_name,
        emergency_contact_mobile
      ),
      classes!applications_class_id_fkey(
        id,
        name,
        term,
        capacity,
        active
      )
    `)
    .order('submitted_at', { ascending: false })
    .limit(500);

  if (error) throw error;

  const applicationIds = (data ?? []).map((row: any) => row.id);
  const noteResult = applicationIds.length
    ? await supabase.rpc('get_application_admin_notes', {
        p_application_ids: applicationIds,
      })
    : { data: [], error: null };

  if (noteResult.error) throw noteResult.error;
  const notes = new Map<string, string>(
    (noteResult.data ?? []).map((row: any): [string, string] => [
      String(row.application_id),
      String(row.admin_notes ?? ''),
    ])
  );

  const classIds = Array.from(new Set((data ?? []).map((row:any) => row.classes?.id).filter(Boolean)));
  const counts = new Map<string, number>();

  if (classIds.length) {
    const { data: enrolments, error: enrolmentError } = await supabase
      .from('enrolments')
      .select('class_id,status')
      .in('class_id', classIds)
      .in('status', ['enrolled', 'suspended']);

    if (enrolmentError) throw enrolmentError;
    for (const row of enrolments ?? []) {
      counts.set(row.class_id, (counts.get(row.class_id) ?? 0) + 1);
    }
  }

  const rows: ApplicationAdminRow[] = (data ?? []).map((row:any) => ({
    id: row.id,
    studentId: row.profiles?.id ?? '',
    name: `${row.profiles?.first_name ?? ''} ${row.profiles?.last_name ?? ''}`.trim() || 'Unnamed applicant',
    firstName: row.profiles?.first_name ?? '',
    lastName: row.profiles?.last_name ?? '',
    email: row.profiles?.email ?? '',
    mobile: row.profiles?.mobile ?? '',
    dateOfBirth: row.profiles?.date_of_birth ?? null,
    emergencyContactName: row.profiles?.emergency_contact_name ?? '',
    emergencyContactMobile: row.profiles?.emergency_contact_mobile ?? '',
    classId: row.classes?.id ?? '',
    className: [row.classes?.name, row.classes?.term].filter(Boolean).join(' — ') || 'Unknown class',
    classCapacity: Number(row.classes?.capacity ?? 0),
    classEnrolled: counts.get(row.classes?.id) ?? 0,
    classActive: Boolean(row.classes?.active),
    status: row.status,
    waitlistPosition: row.waitlist_position,
    source: row.source ?? 'portal',
    externalResponseId: row.external_response_id ?? '',
    submittedAt: row.submitted_at,
    reviewedAt: row.reviewed_at,
    adminNotes: notes.get(row.id) ?? '',
  }));

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Applications</h1>
          <p className="subtitle">Review registrations and manage acceptance, declines and waiting lists.</p>
        </div>
      </div>
      <ApplicationsClient rows={rows} />
    </>
  );
}
