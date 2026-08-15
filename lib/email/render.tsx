import 'server-only';

import { createRequire } from 'node:module';
import { createElement, type ReactNode } from 'react';
import TransactionalEmail from '../../emails/TransactionalEmail';
import { studentPortalUrl } from './config';

// Next.js reserves direct react-dom/server imports for its component renderer.
// This queue is an explicitly Node-only operational renderer, so load React's
// existing Node renderer without adding a second email-rendering dependency.
const nodeRequire = createRequire(import.meta.url);
const { renderToStaticMarkup } = nodeRequire(
  'react-dom/server'
) as typeof import('react-dom/server');

export const EMAIL_TEMPLATE_KEYS = [
  'application_received',
  'application_accepted',
  'application_waitlisted',
  'application_declined',
  'enrolment_suspended',
  'enrolment_reinstated',
] as const;

export type EmailTemplateKey = (typeof EMAIL_TEMPLATE_KEYS)[number];

export type EmailTemplatePayload = {
  firstName: string;
  className: string;
  classTerm: string | null;
  waitlistPosition: number | null;
};

export type RenderedEmail = {
  templateVersion: string;
  subject: string;
  html: string;
  text: string;
};

const TEMPLATE_VERSION = '1';

function cleanText(value: unknown, fallback: string, maxLength = 200) {
  if (typeof value !== 'string') return fallback;
  const cleaned = value
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned ? cleaned.slice(0, maxLength) : fallback;
}

function nullableText(value: unknown, maxLength = 200) {
  const cleaned = cleanText(value, '', maxLength);
  return cleaned || null;
}

function integerOrNull(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function valueFrom(payload: Record<string, unknown>, camel: string, snake: string) {
  return payload[camel] ?? payload[snake];
}

export function isEmailTemplateKey(value: unknown): value is EmailTemplateKey {
  return typeof value === 'string'
    && (EMAIL_TEMPLATE_KEYS as readonly string[]).includes(value);
}

export function normalizeEmailTemplatePayload(payload: unknown): EmailTemplatePayload {
  const data = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};

  return {
    firstName: cleanText(valueFrom(data, 'firstName', 'first_name'), 'Student', 100),
    className: cleanText(valueFrom(data, 'className', 'class_name'), 'your class', 200),
    classTerm: nullableText(valueFrom(data, 'classTerm', 'class_term'), 100),
    waitlistPosition: integerOrNull(
      valueFrom(data, 'waitlistPosition', 'waitlist_position')
    ),
  };
}

function classLabel(payload: EmailTemplatePayload) {
  return payload.classTerm
    ? `${payload.className} — ${payload.classTerm}`
    : payload.className;
}

function paragraph(children: ReactNode) {
  return createElement('p', { style: { margin: '0 0 16px' } }, children);
}

function templateContent(templateKey: EmailTemplateKey, payload: EmailTemplatePayload) {
  const label = classLabel(payload);
  const greeting = paragraph(`Assalamu alaikum ${payload.firstName},`);

  switch (templateKey) {
    case 'application_received':
      return {
        subject: 'We received your ASWJ College application',
        preview: `Your application for ${label} is awaiting review.`,
        heading: 'Application received',
        body: [
          greeting,
          paragraph(`We have received your application for ${label}.`),
          paragraph('It is now awaiting an administrator review. We will send another update when a decision is recorded.'),
        ],
        text: `Assalamu alaikum ${payload.firstName},\n\nWe have received your application for ${label}. It is now awaiting an administrator review. We will send another update when a decision is recorded.`,
      };
    case 'application_accepted':
      return {
        subject: 'Your ASWJ College application was accepted',
        preview: `Your application for ${label} has been accepted.`,
        heading: 'Application accepted',
        body: [
          greeting,
          paragraph(`Your application for ${label} has been accepted.`),
          paragraph('Your active class enrolment and available class details are shown in the Student Portal.'),
        ],
        text: `Assalamu alaikum ${payload.firstName},\n\nYour application for ${label} has been accepted. Your active class enrolment and available class details are shown in the Student Portal.`,
      };
    case 'application_waitlisted': {
      const position = payload.waitlistPosition
        ? ` Your position at the time of this update is ${payload.waitlistPosition}.`
        : '';
      return {
        subject: 'Your ASWJ College application is on the waiting list',
        preview: `You have been placed on the waiting list for ${label}.`,
        heading: 'Waiting list update',
        body: [
          greeting,
          paragraph(`You have been placed on the waiting list for ${label}.${position}`),
          paragraph('The Student Portal will show your latest application status.'),
        ],
        text: `Assalamu alaikum ${payload.firstName},\n\nYou have been placed on the waiting list for ${label}.${position} The Student Portal will show your latest application status.`,
      };
    }
    case 'application_declined':
      return {
        subject: 'Update on your ASWJ College application',
        preview: `A place was not offered for ${label}.`,
        heading: 'Application update',
        body: [
          greeting,
          paragraph(`A place was not offered for your application to ${label}.`),
          paragraph('If you need more information, reply to this email to contact administration.'),
        ],
        text: `Assalamu alaikum ${payload.firstName},\n\nA place was not offered for your application to ${label}. If you need more information, reply to this email to contact administration.`,
      };
    case 'enrolment_suspended':
      return {
        subject: 'Your ASWJ College enrolment was suspended',
        preview: `Your enrolment in ${label} has been suspended.`,
        heading: 'Enrolment suspended',
        body: [
          greeting,
          paragraph(`Your enrolment in ${label} has been suspended.`),
          paragraph('Sign in to the Student Portal for your current enrolment status, or reply to this email to contact administration.'),
        ],
        text: `Assalamu alaikum ${payload.firstName},\n\nYour enrolment in ${label} has been suspended. Sign in to the Student Portal for your current enrolment status, or reply to this email to contact administration.`,
      };
    case 'enrolment_reinstated':
      return {
        subject: 'Your ASWJ College enrolment is active again',
        preview: `Your enrolment in ${label} has been reinstated.`,
        heading: 'Enrolment reinstated',
        body: [
          greeting,
          paragraph(`Your enrolment in ${label} has been reinstated and is active again.`),
          paragraph('Your current enrolment and class details are available in the Student Portal.'),
        ],
        text: `Assalamu alaikum ${payload.firstName},\n\nYour enrolment in ${label} has been reinstated and is active again. Your current enrolment and class details are available in the Student Portal.`,
      };
  }
}

export function renderTransactionalEmail(
  templateKey: EmailTemplateKey,
  rawPayload: unknown,
  appBaseUrl: string
): RenderedEmail {
  const payload = normalizeEmailTemplatePayload(rawPayload);
  const content = templateContent(templateKey, payload);
  const portalUrl = studentPortalUrl(appBaseUrl);
  const html = '<!doctype html>' + renderToStaticMarkup(
    <TransactionalEmail
      preview={content.preview}
      heading={content.heading}
      portalUrl={portalUrl}
    >
      {content.body.map((item, index) => (
        <div key={index}>{item}</div>
      ))}
    </TransactionalEmail>
  );

  return {
    templateVersion: TEMPLATE_VERSION,
    subject: content.subject,
    html,
    text: `${content.text}\n\nOpen Student Portal: ${portalUrl}\n\nThis is an operational message about your ASWJ College record.`,
  };
}
