'use server';

import { revalidatePath } from 'next/cache';
import {
  FormsPayloadError,
  isJsonRecord,
  MICROSOFT_FORMS_PROVIDER,
  parseMicrosoftFormsSubmission,
} from '../../../lib/microsoft-forms';
import { createSupabaseAdminClient } from '../../../lib/supabase/admin';
import { requireAdmin } from '../../../lib/supabase/server';

function refreshFormsPages() {
  revalidatePath('/admin/forms-imports');
  revalidatePath('/admin/applications');
  revalidatePath('/student');
}

async function recordFailure(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  submissionId: string,
  actorId: string,
  code: string,
  note: string,
  expectedAttemptCount: number
) {
  await admin.rpc('record_external_form_processing_failure', {
    p_submission_id: submissionId,
    p_actor_id: actorId,
    p_code: code,
    p_note: note,
    p_expected_attempt_count: expectedAttemptCount,
  });
}

export async function getFormsSubmissionDetails(submissionId: string) {
  await requireAdmin();
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from('external_form_submissions')
    .select(`
      id,
      external_response_id,
      external_form_id,
      received_at,
      completed_at,
      processing_status,
      processing_code,
      processing_note,
      attempt_count,
      last_attempted_at,
      selected_course,
      mapped_payload,
      validation_errors,
      application_id,
      matched_student_id,
      matched_class_id
    `)
    .eq('id', submissionId)
    .eq('provider', MICROSOFT_FORMS_PROVIDER)
    .maybeSingle();

  if (error || !data) throw new Error('Forms submission not found.');

  return {
    id: String(data.id),
    externalResponseId: String(data.external_response_id),
    externalFormId: String(data.external_form_id ?? ''),
    receivedAt: String(data.received_at),
    completedAt: data.completed_at ? String(data.completed_at) : null,
    processingStatus: String(data.processing_status),
    processingCode: data.processing_code ? String(data.processing_code) : null,
    processingNote: data.processing_note ? String(data.processing_note) : null,
    attemptCount: Number(data.attempt_count ?? 0),
    lastAttemptedAt: data.last_attempted_at ? String(data.last_attempted_at) : null,
    selectedCourse: data.selected_course ? String(data.selected_course) : null,
    mappedPayload: data.mapped_payload && typeof data.mapped_payload === 'object'
      ? data.mapped_payload as Record<string, unknown>
      : {},
    validationErrors: Array.isArray(data.validation_errors)
      ? data.validation_errors.map(String)
      : [],
    applicationId: data.application_id ? String(data.application_id) : null,
    matchedStudentId: data.matched_student_id ? String(data.matched_student_id) : null,
    matchedClassId: data.matched_class_id ? String(data.matched_class_id) : null,
  };
}

export async function reprocessFormsSubmission(submissionId: string) {
  const { user, profile } = await requireAdmin();
  if (!profile) throw new Error('Administrator profile required.');

  const admin = createSupabaseAdminClient();
  const { data: submission, error: readError } = await admin
    .from('external_form_submissions')
    .select(`
      id,
      provider,
      external_form_id,
      external_response_id,
      payload,
      processing_status,
      attempt_count
    `)
    .eq('id', submissionId)
    .eq('provider', MICROSOFT_FORMS_PROVIDER)
    .maybeSingle();

  if (readError || !submission) throw new Error('Forms submission not found.');
  if (submission.processing_status === 'processed') {
    throw new Error('This Forms submission has already been processed.');
  }

  if (!isJsonRecord(submission.payload)) {
    await recordFailure(
      admin,
      submissionId,
      user.id,
      'invalid_raw_payload',
      'The stored Forms payload is not a JSON object.',
      Number(submission.attempt_count ?? 0)
    );
    refreshFormsPages();
    throw new Error('The stored Forms payload is invalid and requires manual review.');
  }

  let parsed;
  try {
    parsed = parseMicrosoftFormsSubmission(submission.payload);
  } catch (error) {
    await recordFailure(
      admin,
      submissionId,
      user.id,
      'invalid_raw_payload',
      error instanceof FormsPayloadError
        ? error.message
        : 'The stored Forms payload could not be parsed.',
      Number(submission.attempt_count ?? 0)
    );
    refreshFormsPages();
    throw new Error('The stored Forms payload could not be parsed.');
  }

  if (
    parsed.responseId !== submission.external_response_id
    || parsed.formId !== submission.external_form_id
  ) {
    await recordFailure(
      admin,
      submissionId,
      user.id,
      'response_identity_mismatch',
      'The parsed response identity does not match the immutable intake record.',
      Number(submission.attempt_count ?? 0)
    );
    refreshFormsPages();
    throw new Error('The stored Forms response identity does not match its intake record.');
  }

  const { error: mappingError } = await admin
    .from('external_form_submissions')
    .update({
      mapped_payload: parsed.mappedPayload,
      validation_errors: parsed.validationErrors,
      normalized_email: parsed.normalizedEmail,
      selected_course: parsed.selectedCourse,
      student_first_name: parsed.mappedPayload.studentFirstName,
      student_last_name: parsed.mappedPayload.studentLastName,
      phone_number: parsed.mappedPayload.phoneNumber,
      completed_at: parsed.completedAt,
    })
    .eq('id', submissionId)
    .eq('provider', MICROSOFT_FORMS_PROVIDER);

  if (mappingError) {
    await recordFailure(
      admin,
      submissionId,
      user.id,
      'mapping_update_failed',
      'The parsed Forms fields could not be saved for reprocessing.',
      Number(submission.attempt_count ?? 0)
    );
    refreshFormsPages();
    throw new Error('The Forms fields could not be prepared for reprocessing.');
  }

  const { error } = await admin.rpc('process_external_form_submission', {
    p_submission_id: submissionId,
    p_actor_id: user.id,
  });

  if (error) {
    const { data: current } = await admin
      .from('external_form_submissions')
      .select('processing_status,attempt_count,application_id')
      .eq('id', submissionId)
      .eq('provider', MICROSOFT_FORMS_PROVIDER)
      .maybeSingle();

    const attemptCommitted = current
      && Number(current.attempt_count ?? 0) > Number(submission.attempt_count ?? 0);
    if (
      attemptCommitted
      && (
        (current.processing_status === 'processed' && current.application_id)
        || current.processing_status === 'needs_review'
      )
    ) {
      refreshFormsPages();
      return;
    }

    await recordFailure(
      admin,
      submissionId,
      user.id,
      'processing_error',
      'The stored submission could not be reprocessed automatically.',
      Number(current?.attempt_count ?? submission.attempt_count ?? 0)
    );
    refreshFormsPages();
    throw new Error('The Forms submission could not be reprocessed.');
  }

  refreshFormsPages();
}

export async function updateFormsCourseMapping(
  mappingId: string,
  classId: string | null
) {
  const { user, profile } = await requireAdmin();
  if (!profile) throw new Error('Administrator profile required.');

  const admin = createSupabaseAdminClient();
  const { error } = await admin.rpc('admin_set_external_course_mapping', {
    p_mapping_id: mappingId,
    p_class_id: classId?.trim() || null,
    p_actor_id: user.id,
  });

  if (error) throw new Error('The course mapping could not be saved.');
  refreshFormsPages();
}

export async function assignFormsSubmissionCourse(
  submissionId: string,
  classId: string
) {
  const { user, profile } = await requireAdmin();
  if (!profile) throw new Error('Administrator profile required.');

  const normalizedClassId = classId.trim();
  if (!normalizedClassId) throw new Error('Choose a class.');

  const admin = createSupabaseAdminClient();
  const { error } = await admin.rpc('admin_assign_external_submission_course', {
    p_submission_id: submissionId,
    p_class_id: normalizedClassId,
    p_actor_id: user.id,
  });

  if (error) throw new Error('The submitted course could not be assigned.');
  refreshFormsPages();
}
