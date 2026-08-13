'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '../../../lib/supabase/server';

export type ApplicationDecision = 'accepted' | 'waitlisted' | 'declined';

export type ApplicationRegistrationDetails = {
  applicationId: string;
  studentFirstName: string;
  studentLastName: string;
  dateOfBirth: string;
  emailAddress: string;
  phoneNumber: string;
  guardianFullName: string | null;
  guardianPhoneNumber: string | null;
  medicalLearningAllergyNotes: string | null;
  previousStudies: string | null;
  whatsappOptIn: boolean;
  privacyNoticeVersion: string;
  consentedAt: string;
};

export async function getApplicationRegistrationDetails(
  applicationId: string
): Promise<ApplicationRegistrationDetails | null> {
  const { supabase } = await requireAdmin();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(applicationId)) {
    throw new Error('Application not found.');
  }

  const { data, error } = await supabase
    .rpc('get_application_registration_details', {
      p_application_id: applicationId,
    })
    .maybeSingle();

  if (error) throw new Error('Registration details could not be loaded.');
  if (!data) return null;
  const row = data as Record<string, unknown>;

  return {
    applicationId: String(row.application_id),
    studentFirstName: String(row.student_first_name),
    studentLastName: String(row.student_last_name),
    dateOfBirth: String(row.date_of_birth),
    emailAddress: String(row.email_address),
    phoneNumber: String(row.phone_number),
    guardianFullName: row.guardian_full_name ? String(row.guardian_full_name) : null,
    guardianPhoneNumber: row.guardian_phone_number ? String(row.guardian_phone_number) : null,
    medicalLearningAllergyNotes: row.medical_learning_allergy_notes
      ? String(row.medical_learning_allergy_notes)
      : null,
    previousStudies: row.previous_studies ? String(row.previous_studies) : null,
    whatsappOptIn: Boolean(row.whatsapp_opt_in),
    privacyNoticeVersion: String(row.privacy_notice_version),
    consentedAt: String(row.consented_at),
  };
}

export async function decideApplication(
  applicationId: string,
  decision: ApplicationDecision,
  note?: string
) {
  const { supabase } = await requireAdmin();
  const { error } = await supabase.rpc('admin_decide_application', {
    p_application_id: applicationId,
    p_decision: decision,
    p_note: note?.trim() || null,
  });

  if (error) throw new Error(error.message);

  revalidatePath('/admin/applications');
  revalidatePath('/admin');
  revalidatePath('/admin/students');
  revalidatePath('/admin/classes');
  revalidatePath('/student');
}
