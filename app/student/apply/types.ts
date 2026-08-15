export type RegistrationOption = {
  classId: string;
  className: string;
  term: string | null;
  location: string | null;
  dayOfWeek: number | null;
  startTime: string | null;
  endTime: string | null;
  available: boolean;
  availabilityReason: string | null;
};

export type RegistrationFieldName =
  | 'class_id'
  | 'first_name'
  | 'last_name'
  | 'date_of_birth'
  | 'phone_number'
  | 'guardian_full_name'
  | 'guardian_phone_number'
  | 'medical_learning_allergy_notes'
  | 'previous_studies'
  | 'privacy_consent';

export type RegistrationActionState = {
  status: 'idle' | 'error';
  message: string;
  fieldErrors: Partial<Record<RegistrationFieldName, string>>;
};
