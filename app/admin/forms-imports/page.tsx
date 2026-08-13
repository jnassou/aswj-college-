import { createSupabaseAdminClient } from '../../../lib/supabase/admin';
import { requireAdmin } from '../../../lib/supabase/server';
import FormsImportsClient, {
  FormsClassOption,
  FormsCourseMappingRow,
  FormsSubmissionRow,
} from './FormsImportsClient';

const ATTENTION_STATUSES = ['pending', 'needs_review', 'failed'];

export default async function FormsImportsPage() {
  await requireAdmin();
  const admin = createSupabaseAdminClient();

  const [
    attentionResult,
    processedResult,
    mappingResult,
    classResult,
    pendingCount,
    reviewCount,
    failedCount,
    processedCount,
  ] = await Promise.all([
    admin
      .from('external_form_submissions')
      .select(`
        id,
        external_response_id,
        received_at,
        completed_at,
        processing_status,
        processing_code,
        processing_note,
        attempt_count,
        selected_course,
        student_first_name,
        student_last_name,
        normalized_email,
        phone_number,
        application_id
      `)
      .eq('provider', 'microsoft_forms')
      .in('processing_status', ATTENTION_STATUSES)
      .order('received_at', { ascending: false })
      .limit(500),
    admin
      .from('external_form_submissions')
      .select(`
        id,
        external_response_id,
        received_at,
        completed_at,
        processing_status,
        processing_code,
        processing_note,
        attempt_count,
        selected_course,
        student_first_name,
        student_last_name,
        normalized_email,
        phone_number,
        application_id
      `)
      .eq('provider', 'microsoft_forms')
      .eq('processing_status', 'processed')
      .order('received_at', { ascending: false })
      .limit(100),
    admin
      .from('external_form_course_mappings')
      .select('id,external_course_name,class_id,active')
      .eq('provider', 'microsoft_forms')
      .order('external_course_name'),
    admin
      .from('classes')
      .select('id,name,term,active')
      .order('active', { ascending: false })
      .order('name'),
    admin
      .from('external_form_submissions')
      .select('id', { count: 'exact', head: true })
      .eq('provider', 'microsoft_forms')
      .eq('processing_status', 'pending'),
    admin
      .from('external_form_submissions')
      .select('id', { count: 'exact', head: true })
      .eq('provider', 'microsoft_forms')
      .eq('processing_status', 'needs_review'),
    admin
      .from('external_form_submissions')
      .select('id', { count: 'exact', head: true })
      .eq('provider', 'microsoft_forms')
      .eq('processing_status', 'failed'),
    admin
      .from('external_form_submissions')
      .select('id', { count: 'exact', head: true })
      .eq('provider', 'microsoft_forms')
      .eq('processing_status', 'processed'),
  ]);

  if (attentionResult.error || processedResult.error) {
    throw new Error('Forms submissions could not be loaded.');
  }
  if (mappingResult.error) throw new Error('Forms course mappings could not be loaded.');
  if (classResult.error) throw new Error('Classes could not be loaded.');
  if (pendingCount.error || reviewCount.error || failedCount.error || processedCount.error) {
    throw new Error('Forms import totals could not be loaded.');
  }

  const combined = [...(attentionResult.data ?? []), ...(processedResult.data ?? [])];
  const rows: FormsSubmissionRow[] = combined.map((row: any) => ({
    id: String(row.id),
    externalResponseId: String(row.external_response_id),
    receivedAt: String(row.received_at),
    completedAt: row.completed_at ? String(row.completed_at) : null,
    processingStatus: String(row.processing_status),
    processingCode: row.processing_code ? String(row.processing_code) : null,
    processingNote: row.processing_note ? String(row.processing_note) : null,
    attemptCount: Number(row.attempt_count ?? 0),
    selectedCourse: row.selected_course ? String(row.selected_course) : null,
    studentFirstName: row.student_first_name ? String(row.student_first_name) : null,
    studentLastName: row.student_last_name ? String(row.student_last_name) : null,
    emailAddress: row.normalized_email ? String(row.normalized_email) : null,
    phoneNumber: row.phone_number ? String(row.phone_number) : null,
    applicationId: row.application_id ? String(row.application_id) : null,
  }));

  const mappings: FormsCourseMappingRow[] = (mappingResult.data ?? []).map((row: any) => ({
    id: String(row.id),
    externalCourseName: String(row.external_course_name),
    classId: row.class_id ? String(row.class_id) : null,
    active: Boolean(row.active),
  }));

  const classes: FormsClassOption[] = (classResult.data ?? []).map((row: any) => ({
    id: String(row.id),
    name: String(row.name),
    term: row.term ? String(row.term) : null,
    active: Boolean(row.active),
  }));

  const statusCounts = {
    pending: pendingCount.count ?? 0,
    needs_review: reviewCount.count ?? 0,
    failed: failedCount.count ?? 0,
    processed: processedCount.count ?? 0,
  };

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Forms Imports</h1>
          <p className="subtitle">
            Review Microsoft Forms registrations, connect exact course names and reprocess safe imports.
          </p>
        </div>
      </div>
      <FormsImportsClient
        rows={rows}
        mappings={mappings}
        classes={classes}
        statusCounts={statusCounts}
      />
    </>
  );
}
