import { LEGACY_MICROSOFT_FORMS_COURSES } from './registration-courses';

export const MAX_FORMS_PAYLOAD_BYTES = 256 * 1024;

export const MICROSOFT_FORMS_PROVIDER = 'microsoft_forms';

export const MICROSOFT_FORMS_COURSES = LEGACY_MICROSOFT_FORMS_COURSES;

const COURSE_ALIASES = new Map<string, string>([
  ...MICROSOFT_FORMS_COURSES.map((course) => [course, course] as const),
  [
    'Brothers Shariah Level 1 (Wednesday Evening)',
    'Brothers Shariah Level 1 Wednesday Evening',
  ],
  [
    'Brothers Shariah Level 3 (Wednesday Evening)',
    'Brothers Shariah Level 3 Wednesday Evening',
  ],
  [
    'Sisters Shariah Level 1 (Thursday Morning)',
    'Sisters Shariah Level 1 Thursday Morning',
  ],
  [
    'Sisters Shariah Level 2 (Thursday Morning)',
    'Sisters Shariah Level 2 Thursday Morning',
  ],
  [
    'Sisters Shariah Level 3 (Wednesday Evening)',
    'Sisters Shariah Level 3 Wednesday Evening',
  ],
]);

type JsonRecord = Record<string, unknown>;

export type MicrosoftFormsMappedPayload = {
  responseId: string;
  formId: string;
  startTime: string | null;
  completionTime: string | null;
  respondentEmail: string | null;
  respondentName: string | null;
  language: string | null;
  studentFirstName: string | null;
  studentLastName: string | null;
  dateOfBirth: string | null;
  dateOfBirthIso: string | null;
  emailAddress: string | null;
  phoneNumber: string | null;
  guardianFullName: string | null;
  guardianPhoneNumber: string | null;
  medicalLearningAllergyNotes: string | null;
  previousStudies: string | null;
  selectedCourseRaw: string | null;
  selectedCourse: string | null;
};

export type ParsedMicrosoftFormsSubmission = {
  responseId: string;
  formId: string;
  mappedPayload: MicrosoftFormsMappedPayload;
  normalizedEmail: string | null;
  selectedCourse: string | null;
  completedAt: string | null;
  validationErrors: string[];
};

export class FormsPayloadError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = 'FormsPayloadError';
  }
}

export function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function scalarString(value: unknown) {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function readField(sources: JsonRecord[], names: string[]) {
  for (const source of sources) {
    for (const name of names) {
      if (Object.prototype.hasOwnProperty.call(source, name)) {
        const value = scalarString(source[name]);
        if (value !== null) return value;
      }
    }
  }
  return null;
}

function requireIdentifier(value: string | null, label: string) {
  if (!value) throw new FormsPayloadError(`${label} is required.`);
  if (value.length > 200) throw new FormsPayloadError(`${label} is too long.`);
  return value;
}

function strictIsoDate(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    ? value
    : null;
}

function strictIsoTimestamp(value: string | null) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function canonicalMicrosoftCourse(value: string | null) {
  if (!value) return null;
  return COURSE_ALIASES.get(value.trim()) ?? value.trim();
}

export function parseMicrosoftFormsSubmission(
  body: JsonRecord
): ParsedMicrosoftFormsSubmission {
  const answers = isJsonRecord(body.answers) ? body.answers : null;
  const identitySources = [body, ...(answers ? [answers] : [])];
  const fieldSources = [...(answers ? [answers] : []), body];

  const responseId = requireIdentifier(
    readField(identitySources, ['responseId', 'response_id', 'Response Id', 'Id', 'ID']),
    'responseId'
  );
  const formId = requireIdentifier(
    readField(identitySources, ['formId', 'form_id']),
    'formId'
  );

  const startTime = readField(fieldSources, ['Start time', 'startTime']);
  const completionTime = readField(fieldSources, ['Completion time', 'completionTime']);
  const respondentEmail = readField(fieldSources, ['Email']);
  const respondentName = readField(fieldSources, ['Name']);
  const language = readField(fieldSources, ['Language']);
  const studentFirstName = readField(fieldSources, ['Student First Name']);
  const studentLastName = readField(fieldSources, ['Student Last Name']);
  const dateOfBirth = readField(fieldSources, ['Date of Birth']);
  const emailAddress = readField(fieldSources, ['Email Address']);
  const phoneNumber = readField(fieldSources, [
    'Phone Number (Will be added to Whatsapp Group)',
    'Phone Number',
  ]);
  const guardianFullName = readField(fieldSources, [
    'Guardian Full Name (For Kids Class Only)',
  ]);
  const guardianPhoneNumber = readField(fieldSources, [
    'Guardian Phone Number (For Kids Class Only)',
  ]);
  const medicalLearningAllergyNotes = readField(fieldSources, [
    "List medical conditions, learning considerations or allergies that could impact the students well being.",
    'Medical / learning considerations / allergies',
  ]);
  const previousStudies = readField(fieldSources, [
    'Any Previous Studies (Please list)',
    'Any Previous Studies',
  ]);
  const selectedCourseRaw = readField(fieldSources, ['Select Course']);
  const selectedCourse = canonicalMicrosoftCourse(selectedCourseRaw);
  const dateOfBirthIso = strictIsoDate(dateOfBirth);
  const completedAt = strictIsoTimestamp(completionTime);
  const validationErrors: string[] = [];

  if (!studentFirstName) validationErrors.push('missing_student_first_name');
  if (!studentLastName) validationErrors.push('missing_student_last_name');
  if (!dateOfBirth) validationErrors.push('missing_date_of_birth');
  if (!emailAddress) validationErrors.push('missing_email_address');
  if (!phoneNumber) validationErrors.push('missing_phone_number');
  if (!selectedCourseRaw) validationErrors.push('missing_course');
  if (!completionTime) validationErrors.push('missing_completion_time');
  if (dateOfBirth && !dateOfBirthIso) validationErrors.push('invalid_date_of_birth');
  if (completionTime && !completedAt) validationErrors.push('invalid_completion_time');
  if (emailAddress && emailAddress.length > 320) validationErrors.push('email_too_long');
  if (selectedCourse && selectedCourse.length > 500) validationErrors.push('course_name_too_long');

  const normalizedEmail = emailAddress?.trim().toLowerCase() || null;

  return {
    responseId,
    formId,
    normalizedEmail,
    selectedCourse,
    completedAt,
    validationErrors,
    mappedPayload: {
      responseId,
      formId,
      startTime,
      completionTime,
      respondentEmail,
      respondentName,
      language,
      studentFirstName,
      studentLastName,
      dateOfBirth,
      dateOfBirthIso,
      emailAddress,
      phoneNumber,
      guardianFullName,
      guardianPhoneNumber,
      medicalLearningAllergyNotes,
      previousStudies,
      selectedCourseRaw,
      selectedCourse,
    },
  };
}
