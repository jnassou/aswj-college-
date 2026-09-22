'use client';

import { useMemo, useRef, useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { resetEmailTemplate, updateEmailTemplate } from './actions';
import { useAdminDialog } from '../useAdminDialog';

export type EmailTemplateRow = {
  templateKey: string;
  category: string;
  eventLabel: string;
  sentWhen: string;
  allowedVariables: string[];
  activeVersion: number;
  subjectTemplate: string;
  previewTemplate: string;
  headingTemplate: string;
  bodyTemplate: string;
  buttonLabel: string;
  updatedAt: string | null;
};

type TemplateDraft = Pick<
  EmailTemplateRow,
  'subjectTemplate' | 'previewTemplate' | 'headingTemplate' | 'bodyTemplate' | 'buttonLabel'
>;
type DraftField = keyof TemplateDraft;
type FieldErrors = Partial<Record<DraftField, string>>;

const PLACEHOLDER_PATTERN = /{{([a-z][a-z0-9_]*)}}/g;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u0009\u000B\u000C\u000E-\u001F\u007F]/;
const FIELD_LIMITS: Record<DraftField, { label: string; maximum: number; multiline?: boolean }> = {
  subjectTemplate: { label: 'Subject', maximum: 160 },
  previewTemplate: { label: 'Preview text', maximum: 200 },
  headingTemplate: { label: 'Heading', maximum: 120 },
  bodyTemplate: { label: 'Message', maximum: 5000, multiline: true },
  buttonLabel: { label: 'Button label', maximum: 80 },
};

const VARIABLE_LABELS: Record<string, string> = {
  first_name: 'Student first name',
  class_name: 'Class name',
  class_term: 'Class term',
  class_label: 'Class and term',
  waitlist_position: 'Waitlist number',
  waitlist_position_text: 'Waitlist sentence',
  student_portal_url: 'Student Portal link',
};

const SAMPLE_VALUES: Record<string, string> = {
  first_name: 'Amina',
  class_name: 'Sisters Shariah Level 1',
  class_term: 'Sample term',
  class_label: 'Sisters Shariah Level 1 — Sample term',
  waitlist_position: '3',
  waitlist_position_text: ' Your position at the time of this update is 3.',
  student_portal_url: 'https://aswjcollege.com.au/student',
};

function draftFrom(row: EmailTemplateRow): TemplateDraft {
  return {
    subjectTemplate: row.subjectTemplate,
    previewTemplate: row.previewTemplate,
    headingTemplate: row.headingTemplate,
    bodyTemplate: row.bodyTemplate,
    buttonLabel: row.buttonLabel,
  };
}

function humanise(value: string) {
  return value
    .replaceAll('_', ' ')
    .replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

function formatDateTime(value: string | null) {
  if (!value) return 'Initial wording';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Recently updated';
  return date.toLocaleString('en-AU', {
    timeZone: 'Australia/Sydney',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function interpolate(value: string) {
  return value.replace(PLACEHOLDER_PATTERN, (_match, variable: string) => (
    SAMPLE_VALUES[variable] ?? `{{${variable}}}`
  ));
}

function validateDraft(draft: TemplateDraft, allowedVariables: string[]): FieldErrors {
  const errors: FieldErrors = {};
  const allowed = new Set(allowedVariables);

  for (const field of Object.keys(FIELD_LIMITS) as DraftField[]) {
    const rule = FIELD_LIMITS[field];
    const value = draft[field].trim();
    if (!value) {
      errors[field] = `${rule.label} is required.`;
      continue;
    }
    if (value.length > rule.maximum) {
      errors[field] = `${rule.label} must be ${rule.maximum} characters or fewer.`;
      continue;
    }
    if (!rule.multiline && /[\r\n]/.test(value)) {
      errors[field] = `${rule.label} must be on one line.`;
      continue;
    }
    if (CONTROL_CHARACTER_PATTERN.test(value)) {
      errors[field] = `${rule.label} contains an unsupported character.`;
      continue;
    }

    const unknown = new Set<string>();
    const stripped = value.replace(PLACEHOLDER_PATTERN, (_match, variable: string) => {
      if (!allowed.has(variable)) unknown.add(variable);
      return '';
    });
    if (stripped.includes('{{') || stripped.includes('}}')) {
      errors[field] = `${rule.label} contains an incomplete placeholder.`;
    } else if (unknown.size > 0) {
      errors[field] = `${rule.label} contains an unavailable placeholder: ${Array.from(unknown).join(', ')}.`;
    }
  }

  return errors;
}

function bodyParagraphs(value: string) {
  return interpolate(value)
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

export default function EmailTemplatesClient({ rows }: { rows: EmailTemplateRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<EmailTemplateRow | null>(null);
  const [draft, setDraft] = useState<TemplateDraft | null>(null);
  const [activeField, setActiveField] = useState<DraftField>('bodyTemplate');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [pendingAction, setPendingAction] = useState<'save' | 'reset' | ''>('');
  const [pending, startTransition] = useTransition();
  const fieldRefs = useRef<Partial<Record<DraftField, HTMLInputElement | HTMLTextAreaElement | null>>>({});
  const dialogRef = useAdminDialog<HTMLDivElement>({
    open: selected !== null,
    onClose: () => {
      if (!pending) closeEditor();
    },
  });

  const preview = useMemo(() => {
    if (!draft) return null;
    return {
      subject: interpolate(draft.subjectTemplate),
      preview: interpolate(draft.previewTemplate),
      heading: interpolate(draft.headingTemplate),
      paragraphs: bodyParagraphs(draft.bodyTemplate),
      buttonLabel: interpolate(draft.buttonLabel),
    };
  }, [draft]);

  function openEditor(row: EmailTemplateRow) {
    setSelected(row);
    setDraft(draftFrom(row));
    setActiveField('bodyTemplate');
    setFieldErrors({});
    setError('');
    setMessage('');
    setPendingAction('');
  }

  function closeEditor() {
    if (pending) return;
    setSelected(null);
    setDraft(null);
    setFieldErrors({});
    setError('');
    setPendingAction('');
  }

  function updateField(field: DraftField, value: string) {
    setDraft((current) => current ? { ...current, [field]: value } : current);
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
    setError('');
  }

  function insertVariable(variable: string) {
    if (!draft) return;
    const field = activeField;
    const input = fieldRefs.current[field];
    const value = draft[field];
    const start = input?.selectionStart ?? value.length;
    const end = input?.selectionEnd ?? start;
    const token = `{{${variable}}}`;
    updateField(field, `${value.slice(0, start)}${token}${value.slice(end)}`);
    window.requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !draft) return;
    const validation = validateDraft(draft, selected.allowedVariables);
    if (Object.keys(validation).length > 0) {
      setFieldErrors(validation);
      setError('Check the highlighted fields before saving.');
      const firstInvalid = (Object.keys(FIELD_LIMITS) as DraftField[]).find((field) => validation[field]);
      if (firstInvalid) fieldRefs.current[firstInvalid]?.focus();
      return;
    }

    setError('');
    setPendingAction('save');
    startTransition(async () => {
      try {
        await updateEmailTemplate({
          templateKey: selected.templateKey,
          expectedVersion: selected.activeVersion,
          ...draft,
        });
        setSelected(null);
        setDraft(null);
        setMessage(`${selected.eventLabel} was updated for future emails.`);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'The email message could not be saved.');
      } finally {
        setPendingAction('');
      }
    });
  }

  function restoreDefault() {
    if (!selected) return;
    const confirmed = window.confirm(
      `Restore the original wording for “${selected.eventLabel}”? This affects future emails only.`
    );
    if (!confirmed) return;

    setError('');
    setPendingAction('reset');
    startTransition(async () => {
      try {
        await resetEmailTemplate(selected.templateKey, selected.activeVersion);
        setSelected(null);
        setDraft(null);
        setMessage(`${selected.eventLabel} was restored to its original wording.`);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'The email message could not be restored.');
      } finally {
        setPendingAction('');
      }
    });
  }

  return (
    <div role="region" aria-label="Editable email messages" aria-busy={pending} tabIndex={-1}>
      <div aria-hidden={selected ? true : undefined} inert={selected ? true : undefined}>
        {message && (
          <div className="notice success" role="status">
            <strong>Email message updated</strong>
            {message}
          </div>
        )}

        <div className="portal-alert warning email-template-notice" role="note">
          <strong>Future emails only</strong>
          <span>
            A change applies to emails queued after you save it. Emails already queued or sent keep the wording saved with them.
          </span>
        </div>

        <div className="table-wrap" role="region" aria-label="Email messages" tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th>Message</th>
                <th>Category</th>
                <th>Sent when</th>
                <th>Version</th>
                <th>Updated</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <div className="portal-empty">
                      <strong>No editable email messages found</strong>
                      <span>Email message settings will appear after the email template update is installed.</span>
                    </div>
                  </td>
                </tr>
              ) : rows.map((row) => (
                <tr key={row.templateKey}>
                  <td><strong>{row.eventLabel}</strong><br/><span className="small">{row.subjectTemplate}</span></td>
                  <td><span className="badge blue">{humanise(row.category)}</span></td>
                  <td>{row.sentWhen}</td>
                  <td>Version {row.activeVersion}</td>
                  <td>{formatDateTime(row.updatedAt)}</td>
                  <td>
                    <button
                      className="btn btn-outline"
                      type="button"
                      disabled={pending}
                      onClick={() => openEditor(row)}
                    >
                      Edit message
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selected && draft && preview && (
        <div className="modal-backdrop" onMouseDown={closeEditor}>
          <div
            ref={dialogRef}
            className="modal email-template-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="email-template-title"
            aria-describedby="email-template-description"
            tabIndex={-1}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h3 id="email-template-title">Edit {selected.eventLabel}</h3>
            <p className="subtitle" id="email-template-description">
              Write plain text and use the available student details below. ASWJ branding, the portal link and footer stay protected.
            </p>

            {error && <div className="notice" role="alert" style={{ marginTop: 16 }}>{error}</div>}

            <form onSubmit={save} style={{ marginTop: 18 }} noValidate>
              <div className="email-template-editor">
                <div className="email-template-fields">
                  <div className="field">
                    <label htmlFor="email-template-subject">Subject</label>
                    <input
                      ref={(element) => { fieldRefs.current.subjectTemplate = element; }}
                      id="email-template-subject"
                      value={draft.subjectTemplate}
                      maxLength={160}
                      required
                      aria-invalid={Boolean(fieldErrors.subjectTemplate)}
                      aria-describedby="email-template-subject-help"
                      onFocus={() => setActiveField('subjectTemplate')}
                      onChange={(event) => updateField('subjectTemplate', event.target.value)}
                      data-dialog-initial-focus
                    />
                    <span className={fieldErrors.subjectTemplate ? 'small email-template-field-error' : 'small'} id="email-template-subject-help">
                      {fieldErrors.subjectTemplate ?? `${draft.subjectTemplate.length}/160 characters`}
                    </span>
                  </div>

                  <div className="field">
                    <label htmlFor="email-template-preview">Inbox preview</label>
                    <input
                      ref={(element) => { fieldRefs.current.previewTemplate = element; }}
                      id="email-template-preview"
                      value={draft.previewTemplate}
                      maxLength={200}
                      required
                      aria-invalid={Boolean(fieldErrors.previewTemplate)}
                      aria-describedby="email-template-preview-help"
                      onFocus={() => setActiveField('previewTemplate')}
                      onChange={(event) => updateField('previewTemplate', event.target.value)}
                    />
                    <span className={fieldErrors.previewTemplate ? 'small email-template-field-error' : 'small'} id="email-template-preview-help">
                      {fieldErrors.previewTemplate ?? `${draft.previewTemplate.length}/200 characters`}
                    </span>
                  </div>

                  <div className="field">
                    <label htmlFor="email-template-heading">Heading</label>
                    <input
                      ref={(element) => { fieldRefs.current.headingTemplate = element; }}
                      id="email-template-heading"
                      value={draft.headingTemplate}
                      maxLength={120}
                      required
                      aria-invalid={Boolean(fieldErrors.headingTemplate)}
                      aria-describedby="email-template-heading-help"
                      onFocus={() => setActiveField('headingTemplate')}
                      onChange={(event) => updateField('headingTemplate', event.target.value)}
                    />
                    <span className={fieldErrors.headingTemplate ? 'small email-template-field-error' : 'small'} id="email-template-heading-help">
                      {fieldErrors.headingTemplate ?? `${draft.headingTemplate.length}/120 characters`}
                    </span>
                  </div>

                  <div className="field">
                    <label htmlFor="email-template-body">Message</label>
                    <textarea
                      ref={(element) => { fieldRefs.current.bodyTemplate = element; }}
                      id="email-template-body"
                      value={draft.bodyTemplate}
                      maxLength={5000}
                      required
                      rows={10}
                      aria-invalid={Boolean(fieldErrors.bodyTemplate)}
                      aria-describedby="email-template-body-help"
                      onFocus={() => setActiveField('bodyTemplate')}
                      onChange={(event) => updateField('bodyTemplate', event.target.value)}
                    />
                    <span className={fieldErrors.bodyTemplate ? 'small email-template-field-error' : 'small'} id="email-template-body-help">
                      {fieldErrors.bodyTemplate ?? `Separate paragraphs with a blank line. ${draft.bodyTemplate.length}/5000 characters`}
                    </span>
                  </div>

                  <div className="field">
                    <label htmlFor="email-template-button">Portal button label</label>
                    <input
                      ref={(element) => { fieldRefs.current.buttonLabel = element; }}
                      id="email-template-button"
                      value={draft.buttonLabel}
                      maxLength={80}
                      required
                      aria-invalid={Boolean(fieldErrors.buttonLabel)}
                      aria-describedby="email-template-button-help"
                      onFocus={() => setActiveField('buttonLabel')}
                      onChange={(event) => updateField('buttonLabel', event.target.value)}
                    />
                    <span className={fieldErrors.buttonLabel ? 'small email-template-field-error' : 'small'} id="email-template-button-help">
                      {fieldErrors.buttonLabel ?? `${draft.buttonLabel.length}/80 characters`}
                    </span>
                  </div>

                  <fieldset className="email-template-variables">
                    <legend>Insert student detail</legend>
                    <p className="small">Choose a detail to insert it into the field you are editing.</p>
                    <div className="email-template-variable-list">
                      {selected.allowedVariables.length === 0 ? (
                        <span className="small">This message has no variable student details.</span>
                      ) : selected.allowedVariables.map((variable) => (
                        <button
                          key={variable}
                          className="email-template-variable"
                          type="button"
                          onClick={() => insertVariable(variable)}
                          aria-label={`Insert ${VARIABLE_LABELS[variable] ?? humanise(variable)}`}
                        >
                          + {VARIABLE_LABELS[variable] ?? humanise(variable)}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                </div>

                <aside className="email-template-preview" aria-label="Email preview">
                  <div className="email-template-preview-label">Live preview</div>
                  <div className="email-preview-inbox">
                    <strong>{preview.subject || 'Email subject'}</strong>
                    <span>{preview.preview || 'Inbox preview text'}</span>
                  </div>
                  <div className="email-preview-card">
                    <div className="email-preview-brand">ASWJ College</div>
                    <h4>{preview.heading || 'Email heading'}</h4>
                    <div className="email-preview-copy">
                      {preview.paragraphs.length === 0 ? (
                        <p>Your message will appear here.</p>
                      ) : preview.paragraphs.map((paragraph, index) => (
                        <p key={`${paragraph}-${index}`}>{paragraph}</p>
                      ))}
                    </div>
                    <span className="email-preview-button">{preview.buttonLabel || 'Open Student Portal'}</span>
                    <div className="email-preview-footer">ASWJ College · Automated student notification</div>
                  </div>
                  <p className="small">
                    Example details are shown only for this preview. The correct student and class details are inserted when an email is queued.
                  </p>
                </aside>
              </div>

              <div className="modal-footer email-template-modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={pending}
                  onClick={restoreDefault}
                >
                  {pendingAction === 'reset' ? 'Restoring…' : 'Restore original'}
                </button>
                <div className="actions">
                  <button type="button" className="btn btn-outline" disabled={pending} onClick={closeEditor}>Cancel</button>
                  <button type="submit" className="btn btn-primary" disabled={pending}>
                    {pendingAction === 'save' ? 'Saving…' : 'Save message'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
