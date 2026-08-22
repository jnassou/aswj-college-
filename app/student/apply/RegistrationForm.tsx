'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { formatClassTime } from '../../../lib/class-time';
import { submitStudentRegistration } from './actions';
import type {
  RegistrationActionState,
  RegistrationFieldName,
  RegistrationOption,
} from './types';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const INITIAL_STATE: RegistrationActionState = {
  status: 'idle',
  message: '',
  fieldErrors: {},
};

function availabilityCopy(reason: string | null) {
  switch (reason) {
    case 'registration_not_open':
    case 'before_registration_window':
      return 'Online registration has not opened yet.';
    case 'registration_closed':
    case 'after_registration_window':
      return 'Online registration has closed.';
    default:
      return 'Online registration is not currently available.';
  }
}

function optionSchedule(option: RegistrationOption) {
  const day = option.dayOfWeek === null ? null : DAYS[option.dayOfWeek] ?? null;
  const time = option.startTime
    ? `${formatClassTime(option.startTime)}${option.endTime ? `–${formatClassTime(option.endTime)}` : ''}`
    : null;
  return [day, time, option.location].filter(Boolean).join(' · ');
}

function fieldErrorId(field: RegistrationFieldName) {
  return `${field}-error`;
}

function dateOfBirthParts(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match
    ? { year: match[1], month: match[2], day: match[3] }
    : { year: '', month: '', day: '' };
}

function isLeapYear(year: number) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(month: string, year: string) {
  const monthNumber = Number(month);
  if (!monthNumber) return 31;
  if (monthNumber === 2) {
    if (!year) return 29;
    return isLeapYear(Number(year)) ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(monthNumber) ? 30 : 31;
}

export default function RegistrationForm({
  email,
  privacyNoticeVersion,
  options,
  initialValues,
}: {
  email: string;
  privacyNoticeVersion: string;
  options: RegistrationOption[];
  initialValues: {
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    phoneNumber: string;
  };
}) {
  const [state, formAction, pending] = useActionState(
    submitStudentRegistration,
    INITIAL_STATE
  );
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const initialDateOfBirth = dateOfBirthParts(initialValues.dateOfBirth);
  const [dateOfBirthDay, setDateOfBirthDay] = useState(initialDateOfBirth.day);
  const [dateOfBirthMonth, setDateOfBirthMonth] = useState(initialDateOfBirth.month);
  const [dateOfBirthYear, setDateOfBirthYear] = useState(initialDateOfBirth.year);
  const availableOptions = options.filter((option) => option.available);
  const currentYear = Number(new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
  }).format(new Date()));
  const yearOptions = Array.from(
    { length: currentYear - 1900 + 1 },
    (_, index) => String(currentYear - index)
  );
  const maximumDay = daysInMonth(dateOfBirthMonth, dateOfBirthYear);
  const dayOptions = Array.from({ length: maximumDay }, (_, index) => String(index + 1));

  useEffect(() => {
    if (state.status === 'error') errorSummaryRef.current?.focus();
  }, [state]);

  const errorFor = (field: RegistrationFieldName) => state.fieldErrors[field];
  const describedBy = (field: RegistrationFieldName, helperId?: string) => {
    const ids = [helperId, errorFor(field) ? fieldErrorId(field) : null].filter(Boolean);
    return ids.length ? ids.join(' ') : undefined;
  };

  const changeDateOfBirthMonth = (month: string) => {
    setDateOfBirthMonth(month);
    if (dateOfBirthDay && Number(dateOfBirthDay) > daysInMonth(month, dateOfBirthYear)) {
      setDateOfBirthDay('');
    }
  };

  const changeDateOfBirthYear = (year: string) => {
    setDateOfBirthYear(year);
    if (dateOfBirthDay && Number(dateOfBirthDay) > daysInMonth(dateOfBirthMonth, year)) {
      setDateOfBirthDay('');
    }
  };

  return (
    <form action={formAction}>
      {state.status === 'error' && (
        <div
          ref={errorSummaryRef}
          className="notice"
          role="alert"
          tabIndex={-1}
          aria-live="polite"
        >
          <strong>Application not submitted</strong>
          {state.message}
        </div>
      )}

      <section className="card" aria-labelledby="class-heading">
        <h2 id="class-heading" style={{ marginTop: 0 }}>Choose a class</h2>
        <div className="field">
          <label htmlFor="class_id">Class</label>
          <select
            id="class_id"
            name="class_id"
            defaultValue=""
            required
            aria-invalid={Boolean(errorFor('class_id'))}
            aria-describedby={describedBy('class_id')}
          >
            <option value="" disabled>Select an available class</option>
            {options.map((option) => (
              <option
                key={option.classId}
                value={option.classId}
                disabled={!option.available}
              >
                {[option.className, option.term, optionSchedule(option)].filter(Boolean).join(' — ')}
                {option.available ? '' : ' — unavailable'}
              </option>
            ))}
          </select>
          {errorFor('class_id') && (
            <span id={fieldErrorId('class_id')} className="small" style={{ color: 'var(--danger)' }}>
              {errorFor('class_id')}
            </span>
          )}
        </div>

        <div style={{ display: 'grid', gap: 10 }}>
          {options.map((option) => (
            <article
              key={option.classId}
              style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}
            >
              <strong>{option.className}</strong>
              {option.term && <div className="small" style={{ marginTop: 4 }}>{option.term}</div>}
              {optionSchedule(option) && <div className="small" style={{ marginTop: 3 }}>{optionSchedule(option)}</div>}
              {!option.available && (
                <div className="small" style={{ marginTop: 4 }}>{availabilityCopy(option.availabilityReason)}</div>
              )}
            </article>
          ))}
        </div>
      </section>

      <section className="card" style={{ marginTop: 16 }} aria-labelledby="student-details-heading">
        <h2 id="student-details-heading" style={{ marginTop: 0 }}>Student details</h2>
        <div className="form-row">
          <div className="field">
            <label htmlFor="first_name">First name</label>
            <input
              id="first_name"
              name="first_name"
              autoComplete="given-name"
              defaultValue={initialValues.firstName}
              maxLength={100}
              required
              aria-invalid={Boolean(errorFor('first_name'))}
              aria-describedby={describedBy('first_name')}
            />
            {errorFor('first_name') && <span id={fieldErrorId('first_name')} className="small" style={{ color: 'var(--danger)' }}>{errorFor('first_name')}</span>}
          </div>
          <div className="field">
            <label htmlFor="last_name">Last name</label>
            <input
              id="last_name"
              name="last_name"
              autoComplete="family-name"
              defaultValue={initialValues.lastName}
              maxLength={100}
              required
              aria-invalid={Boolean(errorFor('last_name'))}
              aria-describedby={describedBy('last_name')}
            />
            {errorFor('last_name') && <span id={fieldErrorId('last_name')} className="small" style={{ color: 'var(--danger)' }}>{errorFor('last_name')}</span>}
          </div>
        </div>

        <div className="form-row">
          <fieldset className="dob-fieldset">
            <legend>Date of birth</legend>
            <div className="dob-fields">
              <div className="field">
                <label htmlFor="date_of_birth_day">Day</label>
                <select
                  id="date_of_birth_day"
                  name="date_of_birth_day"
                  autoComplete="bday-day"
                  value={dateOfBirthDay}
                  onChange={(event) => setDateOfBirthDay(event.target.value)}
                  required
                  aria-invalid={Boolean(errorFor('date_of_birth'))}
                  aria-describedby={describedBy('date_of_birth', 'date-of-birth-helper')}
                >
                  <option value="" disabled>Day</option>
                  {dayOptions.map((day) => (
                    <option key={day} value={day.padStart(2, '0')}>{day}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="date_of_birth_month">Month</label>
                <select
                  id="date_of_birth_month"
                  name="date_of_birth_month"
                  autoComplete="bday-month"
                  value={dateOfBirthMonth}
                  onChange={(event) => changeDateOfBirthMonth(event.target.value)}
                  required
                  aria-invalid={Boolean(errorFor('date_of_birth'))}
                  aria-describedby={describedBy('date_of_birth', 'date-of-birth-helper')}
                >
                  <option value="" disabled>Month</option>
                  {MONTHS.map((month, index) => (
                    <option key={month} value={String(index + 1).padStart(2, '0')}>{month}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="date_of_birth_year">Year</label>
                <select
                  id="date_of_birth_year"
                  name="date_of_birth_year"
                  autoComplete="bday-year"
                  value={dateOfBirthYear}
                  onChange={(event) => changeDateOfBirthYear(event.target.value)}
                  required
                  aria-invalid={Boolean(errorFor('date_of_birth'))}
                  aria-describedby={describedBy('date_of_birth', 'date-of-birth-helper')}
                >
                  <option value="" disabled>Year</option>
                  {yearOptions.map((year) => <option key={year} value={year}>{year}</option>)}
                </select>
              </div>
            </div>
            <span id="date-of-birth-helper" className="small">Choose day, month and year.</span>
            {errorFor('date_of_birth') && <span id={fieldErrorId('date_of_birth')} className="small" style={{ color: 'var(--danger)' }}>{errorFor('date_of_birth')}</span>}
          </fieldset>
          <div className="field">
            <label htmlFor="email_address">Confirmed portal email</label>
            <input id="email_address" value={email} autoComplete="email" readOnly aria-describedby="email-helper" />
            <span id="email-helper" className="small">Applications are linked to this signed-in account.</span>
          </div>
        </div>

        <div className="field">
          <label htmlFor="phone_number">Phone number</label>
          <input
            id="phone_number"
            name="phone_number"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            defaultValue={initialValues.phoneNumber}
            maxLength={50}
            required
            aria-invalid={Boolean(errorFor('phone_number'))}
            aria-describedby={describedBy('phone_number', 'phone-helper')}
          />
          <span id="phone-helper" className="small">Include the country code if the number is outside Australia.</span>
          {errorFor('phone_number') && <span id={fieldErrorId('phone_number')} className="small" style={{ color: 'var(--danger)' }}>{errorFor('phone_number')}</span>}
        </div>

        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13 }}>
          <input name="whatsapp_opt_in" type="checkbox" style={{ marginTop: 2 }} />
          <span>I agree to this phone number being added to the class WhatsApp group if my application is accepted.</span>
        </label>
      </section>

      <section className="card" style={{ marginTop: 16 }} aria-labelledby="guardian-heading">
        <h2 id="guardian-heading" style={{ marginTop: 0 }}>Guardian details</h2>
        <p className="small">Optional. If these details apply, complete both fields.</p>
        <div className="form-row">
          <div className="field">
            <label htmlFor="guardian_full_name">Guardian full name</label>
            <input
              id="guardian_full_name"
              name="guardian_full_name"
              autoComplete="name"
              maxLength={100}
              aria-invalid={Boolean(errorFor('guardian_full_name'))}
              aria-describedby={describedBy('guardian_full_name')}
            />
            {errorFor('guardian_full_name') && <span id={fieldErrorId('guardian_full_name')} className="small" style={{ color: 'var(--danger)' }}>{errorFor('guardian_full_name')}</span>}
          </div>
          <div className="field">
            <label htmlFor="guardian_phone_number">Guardian phone number</label>
            <input
              id="guardian_phone_number"
              name="guardian_phone_number"
              type="tel"
              inputMode="tel"
              maxLength={50}
              aria-invalid={Boolean(errorFor('guardian_phone_number'))}
              aria-describedby={describedBy('guardian_phone_number')}
            />
            {errorFor('guardian_phone_number') && <span id={fieldErrorId('guardian_phone_number')} className="small" style={{ color: 'var(--danger)' }}>{errorFor('guardian_phone_number')}</span>}
          </div>
        </div>
      </section>

      <section className="card" style={{ marginTop: 16 }} aria-labelledby="support-heading">
        <h2 id="support-heading" style={{ marginTop: 0 }}>Learning and wellbeing</h2>
        <div className="field">
          <label htmlFor="medical_learning_allergy_notes">Medical conditions, learning considerations or allergies</label>
          <textarea
            id="medical_learning_allergy_notes"
            name="medical_learning_allergy_notes"
            maxLength={2000}
            aria-describedby={describedBy('medical_learning_allergy_notes', 'wellbeing-helper')}
            aria-invalid={Boolean(errorFor('medical_learning_allergy_notes'))}
          />
          <span id="wellbeing-helper" className="small">Optional. Share only information relevant to safe participation and learning support.</span>
          {errorFor('medical_learning_allergy_notes') && <span id={fieldErrorId('medical_learning_allergy_notes')} className="small" style={{ color: 'var(--danger)' }}>{errorFor('medical_learning_allergy_notes')}</span>}
        </div>
        <div className="field">
          <label htmlFor="previous_studies">Previous studies</label>
          <textarea
            id="previous_studies"
            name="previous_studies"
            maxLength={2000}
            aria-describedby={describedBy('previous_studies', 'studies-helper')}
            aria-invalid={Boolean(errorFor('previous_studies'))}
          />
          <span id="studies-helper" className="small">Optional. List studies that may help the College assess the application.</span>
          {errorFor('previous_studies') && <span id={fieldErrorId('previous_studies')} className="small" style={{ color: 'var(--danger)' }}>{errorFor('previous_studies')}</span>}
        </div>
      </section>

      <section className="card" style={{ marginTop: 16 }} aria-labelledby="privacy-heading">
        <h2 id="privacy-heading" style={{ marginTop: 0 }}>Privacy notice</h2>
        <p style={{ fontSize: 13, lineHeight: 1.55 }}>
          ASWJ College will use these details to assess and manage the application,
          contact you about the selected class, and support student wellbeing. Optional
          medical, learning and allergy information is available only to authorised staff
          who need it for registration or student support. Contact administration if your
          details need to be corrected.
        </p>
        <p className="small">Notice version {privacyNoticeVersion}</p>
        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13 }}>
          <input
            name="privacy_consent"
            type="checkbox"
            required
            aria-invalid={Boolean(errorFor('privacy_consent'))}
            aria-describedby={describedBy('privacy_consent')}
            style={{ marginTop: 2 }}
          />
          <span>I have read this notice and agree to my details being used for registration and student support.</span>
        </label>
        {errorFor('privacy_consent') && <span id={fieldErrorId('privacy_consent')} className="small" style={{ color: 'var(--danger)', display: 'block', marginTop: 8 }}>{errorFor('privacy_consent')}</span>}
      </section>

      {availableOptions.length === 0 && (
        <div className="portal-alert warning" role="status">
          <strong>Online applications are not currently available.</strong>
          <span>
            {options.length === 0
              ? 'Classes appear here when administration enables Student Portal applications on an active class.'
              : 'The listed classes are outside their registration dates.'}
          </span>
        </div>
      )}

      <div className="actions" style={{ marginTop: 20 }}>
        <button
          className="btn btn-primary"
          type="submit"
          disabled={pending || availableOptions.length === 0}
        >
          {pending ? 'Submitting securely…' : 'Submit application'}
        </button>
        <a className="btn btn-outline" href="/student">Cancel</a>
      </div>
    </form>
  );
}
