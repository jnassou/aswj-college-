'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  REGISTRATION_COURSES,
  REGISTRATION_PRIVACY_NOTICE_VERSION,
  type RegistrationCourseName,
} from '../../../lib/registration-courses';
import { createSupabaseServerClient } from '../../../lib/supabase/server';
import type {
  RegistrationActionState,
  RegistrationFieldName,
} from './types';

const NAME_MAX_LENGTH = 100;
const PHONE_MAX_LENGTH = 50;
const NOTES_MAX_LENGTH = 2000;

type RegistrationRpcResult = {
  result: string;
  application_id: string | null;
  application_status: string | null;
};

function fieldValue(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === 'string' ? value.normalize('NFKC').trim() : '';
}

function isRegistrationCourse(value: string): value is RegistrationCourseName {
  return (REGISTRATION_COURSES as readonly string[]).includes(value);
}

function hasSingleLineControls(value: string) {
  return /[\u0000-\u001f\u007f-\u009f]/.test(value);
}

function hasMultilineControls(value: string) {
  return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(value);
}

function isValidPhone(value: string) {
  if (!value || value.length > PHONE_MAX_LENGTH) return false;
  if (!/^[-0-9+(). ]+$/.test(value)) return false;
  if ((value.match(/\+/g) ?? []).length > 1 || (value.includes('+') && !value.startsWith('+'))) {
    return false;
  }
  const digitCount = value.replace(/\D/g, '').length;
  return digitCount >= 8 && digitCount <= 15;
}

function strictIsoPastDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  if (year < 1900) return false;

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    return false;
  }

  const todayParts = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: string) => todayParts.find((item) => item.type === type)?.value ?? '';
  const today = `${part('year')}-${part('month')}-${part('day')}`;
  return value < today;
}

function errorState(
  message: string,
  fieldErrors: Partial<Record<RegistrationFieldName, string>> = {}
): RegistrationActionState {
  return { status: 'error', message, fieldErrors };
}

export async function submitStudentRegistration(
  _previousState: RegistrationActionState,
  formData: FormData
): Promise<RegistrationActionState> {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) redirect('/login?next=%2Fstudent%2Fapply');
  if (!user.email || !user.email_confirmed_at) {
    redirect('/login?error=confirm_required&next=%2Fstudent%2Fapply');
  }

  const authRole = String(user.app_metadata?.role ?? 'student');
  if (authRole !== 'student') {
    return errorState('Student access is required to submit a class application.');
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id,role')
    .eq('id', user.id)
    .maybeSingle();

  if (profileError || !profile) {
    return errorState('Your Student Portal profile could not be verified. Please contact administration.');
  }
  if (profile.role !== 'student') {
    return errorState('Student access is required to submit a class application.');
  }

  const courseName = fieldValue(formData, 'course_name');
  const firstName = fieldValue(formData, 'first_name');
  const lastName = fieldValue(formData, 'last_name');
  const dateOfBirth = fieldValue(formData, 'date_of_birth');
  const phoneNumber = fieldValue(formData, 'phone_number');
  const guardianFullName = fieldValue(formData, 'guardian_full_name');
  const guardianPhoneNumber = fieldValue(formData, 'guardian_phone_number');
  const medicalLearningAllergyNotes = fieldValue(
    formData,
    'medical_learning_allergy_notes'
  );
  const previousStudies = fieldValue(formData, 'previous_studies');
  const whatsappOptIn = formData.get('whatsapp_opt_in') === 'on';
  const privacyConsent = formData.get('privacy_consent') === 'on';
  const fieldErrors: Partial<Record<RegistrationFieldName, string>> = {};

  if (!isRegistrationCourse(courseName)) {
    fieldErrors.course_name = 'Choose an available course.';
  }
  if (!firstName || firstName.length > NAME_MAX_LENGTH || hasSingleLineControls(firstName)) {
    fieldErrors.first_name = 'Enter a valid first name of 100 characters or fewer.';
  }
  if (!lastName || lastName.length > NAME_MAX_LENGTH || hasSingleLineControls(lastName)) {
    fieldErrors.last_name = 'Enter a valid last name of 100 characters or fewer.';
  }
  if (!strictIsoPastDate(dateOfBirth)) {
    fieldErrors.date_of_birth = 'Enter a valid date of birth in the past.';
  }
  if (!isValidPhone(phoneNumber)) {
    fieldErrors.phone_number = 'Enter a valid phone number containing 8 to 15 digits.';
  }
  if (
    guardianFullName
    && (guardianFullName.length > NAME_MAX_LENGTH || hasSingleLineControls(guardianFullName))
  ) {
    fieldErrors.guardian_full_name = 'Enter a guardian name of 100 characters or fewer.';
  }
  if (guardianPhoneNumber && !isValidPhone(guardianPhoneNumber)) {
    fieldErrors.guardian_phone_number = 'Enter a valid guardian phone number.';
  }
  if (Boolean(guardianFullName) !== Boolean(guardianPhoneNumber)) {
    if (!guardianFullName) fieldErrors.guardian_full_name = 'Enter the guardian name as well.';
    if (!guardianPhoneNumber) {
      fieldErrors.guardian_phone_number = 'Enter the guardian phone number as well.';
    }
  }
  if (
    medicalLearningAllergyNotes.length > NOTES_MAX_LENGTH
    || hasMultilineControls(medicalLearningAllergyNotes)
  ) {
    fieldErrors.medical_learning_allergy_notes = 'Keep these notes to 2,000 characters or fewer.';
  }
  if (previousStudies.length > NOTES_MAX_LENGTH || hasMultilineControls(previousStudies)) {
    fieldErrors.previous_studies = 'Keep previous studies to 2,000 characters or fewer.';
  }
  if (!privacyConsent) {
    fieldErrors.privacy_consent = 'Read and accept the privacy notice to continue.';
  }

  if (Object.keys(fieldErrors).length > 0) {
    return errorState('Check the highlighted fields and try again.', fieldErrors);
  }

  const { data, error } = await supabase
    .rpc('student_submit_registration', {
      p_course_name: courseName,
      p_first_name: firstName,
      p_last_name: lastName,
      p_date_of_birth: dateOfBirth,
      p_phone_number: phoneNumber,
      p_guardian_full_name: guardianFullName || null,
      p_guardian_phone_number: guardianPhoneNumber || null,
      p_medical_learning_allergy_notes: medicalLearningAllergyNotes || null,
      p_previous_studies: previousStudies || null,
      p_whatsapp_opt_in: whatsappOptIn,
      p_privacy_notice_version: REGISTRATION_PRIVACY_NOTICE_VERSION,
    })
    .single();

  if (error || !data) {
    return errorState('Your application could not be submitted. Please try again.');
  }

  const result = data as RegistrationRpcResult;
  if (!result.application_id) {
    return errorState('Your application could not be confirmed. Please try again.');
  }

  revalidatePath('/student');
  if (result.result === 'already_exists') redirect('/student?already=1');
  if (result.result === 'created') redirect('/student?applied=1');

  return errorState('Your application could not be confirmed. Please try again.');
}
