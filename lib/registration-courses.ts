export const REGISTRATION_COURSES = [
  'Brothers Shariah Level 1 Wednesday Evening',
  'Brothers Shariah Level 3 Wednesday Evening',
  'Sisters Shariah Level 1 Thursday Morning',
  'Sisters Shariah Level 2 Thursday Morning',
  'Sisters Shariah Level 3 Wednesday Evening',
] as const;

export type RegistrationCourseName = (typeof REGISTRATION_COURSES)[number];

export const REGISTRATION_PRIVACY_NOTICE_VERSION = '2026-08-14';
