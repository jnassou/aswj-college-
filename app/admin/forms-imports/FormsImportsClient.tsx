'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  assignFormsSubmissionCourse,
  getFormsSubmissionDetails,
  reprocessFormsSubmission,
  updateFormsCourseMapping,
} from './actions';

export type FormsSubmissionRow = {
  id: string;
  externalResponseId: string;
  receivedAt: string;
  completedAt: string | null;
  processingStatus: string;
  processingCode: string | null;
  processingNote: string | null;
  attemptCount: number;
  selectedCourse: string | null;
  studentFirstName: string | null;
  studentLastName: string | null;
  emailAddress: string | null;
  phoneNumber: string | null;
  applicationId: string | null;
};

export type FormsCourseMappingRow = {
  id: string;
  externalCourseName: string;
  classId: string | null;
  active: boolean;
};

export type FormsClassOption = {
  id: string;
  name: string;
  term: string | null;
  active: boolean;
  registrationEnabled: boolean;
};

type FormsSubmissionDetail = Awaited<ReturnType<typeof getFormsSubmissionDetails>>;

type StatusCounts = {
  pending: number;
  needs_review: number;
  failed: number;
  processed: number;
};

const FILTERS = ['attention', 'all', 'pending', 'needs_review', 'failed', 'processed'] as const;

function textValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : '—';
}

function formatDate(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function label(value: string) {
  return value.replaceAll('_', ' ').replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

function statusTone(status: string) {
  if (status === 'processed') return 'green';
  if (status === 'failed') return 'red';
  if (status === 'needs_review') return 'amber';
  return 'blue';
}

function studentName(row: FormsSubmissionRow) {
  return [row.studentFirstName, row.studentLastName].filter(Boolean).join(' ') || 'Unnamed applicant';
}

export default function FormsImportsClient({
  rows,
  mappings,
  classes,
  statusCounts,
  legacyAvailable,
}: {
  rows: FormsSubmissionRow[];
  mappings: FormsCourseMappingRow[];
  classes: FormsClassOption[];
  statusCounts: StatusCounts;
  legacyAvailable: boolean;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('attention');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<FormsSubmissionRow | null>(null);
  const [detail, setDetail] = useState<FormsSubmissionDetail | null>(null);
  const [pendingKey, setPendingKey] = useState('');
  const [assignmentClassId, setAssignmentClassId] = useState('');
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();
  const [mappingDrafts, setMappingDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(mappings.map((mapping) => [mapping.id, mapping.classId ?? '']))
  );

  useEffect(() => {
    setMappingDrafts(
      Object.fromEntries(mappings.map((mapping) => [mapping.id, mapping.classId ?? '']))
    );
  }, [mappings]);

  const totalCount = Object.values(statusCounts).reduce((total, count) => total + count, 0);
  const counts: Record<string, number> = {
    ...statusCounts,
    all: totalCount,
    attention: statusCounts.pending + statusCounts.needs_review + statusCounts.failed,
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesFilter = filter === 'all'
        || (filter === 'attention' && row.processingStatus !== 'processed')
        || row.processingStatus === filter;
      if (!matchesFilter) return false;
      if (!q) return true;
      return [
        row.externalResponseId,
        row.selectedCourse,
        row.processingCode,
        row.studentFirstName,
        row.studentLastName,
        row.emailAddress,
        row.phoneNumber,
      ].some((value) => String(value ?? '').toLowerCase().includes(q));
    });
  }, [rows, filter, query]);

  const classById = useMemo(
    () => new Map(classes.map((classOption) => [classOption.id, classOption])),
    [classes]
  );

  const openDetails = (row: FormsSubmissionRow) => {
    setSelected(row);
    setDetail(null);
    setAssignmentClassId('');
    setError('');
    setPendingKey(`detail:${row.id}`);
    startTransition(async () => {
      try {
        setDetail(await getFormsSubmissionDetails(row.id));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'The submission details could not be loaded.');
      } finally {
        setPendingKey('');
      }
    });
  };

  const runReprocess = (row: FormsSubmissionRow) => {
    setError('');
    setPendingKey(`retry:${row.id}`);
    startTransition(async () => {
      try {
        await reprocessFormsSubmission(row.id);
        setSelected(null);
        setDetail(null);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'The submission could not be reprocessed.');
      } finally {
        setPendingKey('');
      }
    });
  };

  const saveMapping = (mapping: FormsCourseMappingRow, classId: string) => {
    setMappingDrafts((current) => ({ ...current, [mapping.id]: classId }));
    setError('');
    setPendingKey(`mapping:${mapping.id}`);
    startTransition(async () => {
      try {
        await updateFormsCourseMapping(mapping.id, classId || null);
        router.refresh();
      } catch (err) {
        setMappingDrafts((current) => ({
          ...current,
          [mapping.id]: mapping.classId ?? '',
        }));
        setError(err instanceof Error ? err.message : 'The course mapping could not be saved.');
      } finally {
        setPendingKey('');
      }
    });
  };

  const assignCourse = (row: FormsSubmissionRow) => {
    setError('');
    setPendingKey(`assign:${row.id}`);
    startTransition(async () => {
      try {
        await assignFormsSubmissionCourse(row.id, assignmentClassId);
        setSelected(null);
        setDetail(null);
        setAssignmentClassId('');
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'The submitted course could not be assigned.');
      } finally {
        setPendingKey('');
      }
    });
  };

  return (
    <>
      {error && !selected && <div className="notice">{error}</div>}

      <section className="section">
        <div className="section-head">
          <div>
            <h2>Exact course mapping</h2>
            <div className="small">
              These links drive the Student Portal form and legacy imports. A linked class must also allow Portal applications in Classes.
            </div>
          </div>
          <a className="btn btn-outline" href="/admin/classes">Manage classes</a>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Application course</th><th>ASWJ class</th><th>Status</th></tr></thead>
            <tbody>
              {mappings.map((mapping) => {
                const mappedClass = mapping.classId ? classById.get(mapping.classId) : null;
                const mappingStatus = !mapping.active
                  ? { text: 'Inactive mapping', tone: 'grey' }
                  : !mapping.classId
                    ? { text: 'Needs class', tone: 'amber' }
                    : !mappedClass || !mappedClass.active
                      ? { text: 'Archived class', tone: 'red' }
                      : !mappedClass.registrationEnabled
                        ? { text: 'Portal disabled', tone: 'amber' }
                      : { text: 'Linked', tone: 'green' };

                return (
                  <tr key={mapping.id}>
                    <td><strong>{mapping.externalCourseName}</strong></td>
                    <td>
                      <select
                        aria-label={`Class for ${mapping.externalCourseName}`}
                        value={mappingDrafts[mapping.id] ?? ''}
                        disabled={pending || !mapping.active}
                        onChange={(event) => saveMapping(mapping, event.target.value)}
                      >
                        <option value="">Not linked</option>
                        {classes.map((classOption) => (
                          <option
                            key={classOption.id}
                            value={classOption.id}
                            disabled={!classOption.active}
                          >
                            {classOption.name}
                            {classOption.term ? ` — ${classOption.term}` : ''}
                            {!classOption.active ? ' (archived)' : ''}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td><span className={`badge ${mappingStatus.tone}`}>{mappingStatus.text}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <h2>Legacy Microsoft Forms imports</h2>
            <div className="small">Raw legacy responses remain private and are retained for audit and recovery.</div>
          </div>
        </div>

        {!legacyAvailable ? (
          <div className="card">
            <strong>Legacy Microsoft Forms review is unavailable.</strong>
            <p className="small" style={{ marginBottom: 0 }}>
              Native Student Portal applications and the course links above continue to work normally.
            </p>
          </div>
        ) : (
          <>
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="form-row" style={{ alignItems: 'end' }}>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>Search loaded imports</label>
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Student, email, phone, course or response ID"
                  />
                </div>
                <div className="small">
                  Showing {visible.length} loaded record{visible.length === 1 ? '' : 's'}; {totalCount} total
                </div>
              </div>
            </div>

            <div className="filters">
              {FILTERS.map((item) => (
                <button
                  key={item}
                  className={`filter ${filter === item ? 'active' : ''}`}
                  onClick={() => setFilter(item)}
                >
                  {label(item)} ({counts[item] ?? 0})
                </button>
              ))}
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Student</th><th>Requested course</th><th>Completed</th><th>Status</th><th>Attempts</th><th></th></tr>
                </thead>
                <tbody>
                  {visible.length === 0 ? (
                    <tr><td colSpan={6}><span className="small">No loaded Forms imports match this view.</span></td></tr>
                  ) : visible.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <strong>{studentName(row)}</strong><br/>
                        <span className="small">{row.emailAddress || row.phoneNumber || row.externalResponseId}</span>
                      </td>
                      <td>{row.selectedCourse || '—'}</td>
                      <td>{formatDate(row.completedAt ?? row.receivedAt)}</td>
                      <td>
                        <span className={`badge ${statusTone(row.processingStatus)}`}>
                          {label(row.processingStatus)}
                        </span><br/>
                        {row.processingCode && <span className="small">{label(row.processingCode)}</span>}
                      </td>
                      <td>{row.attemptCount}</td>
                      <td>
                        <button
                          className="btn btn-outline"
                          disabled={pending}
                          onClick={() => openDetails(row)}
                        >
                          Review
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {legacyAvailable && selected && (
        <div className="modal-backdrop" onMouseDown={() => !pending && setSelected(null)}>
          <div
            className="modal"
            onMouseDown={(event) => event.stopPropagation()}
            style={{ width: 'min(760px,100%)', maxHeight: '92vh', overflow: 'auto' }}
          >
            <h3>{studentName(selected)}</h3>
            <p className="subtitle">Response {selected.externalResponseId}</p>

            {error && <div className="notice" style={{ marginTop: 16 }}>{error}</div>}
            {!detail && !error && (
              <div className="card" style={{ marginTop: 18 }}>
                Loading protected submission details…
              </div>
            )}

            {detail && (
              <>
                <div className="portal-grid" style={{ marginTop: 18 }}>
                  <div className="card">
                    <div className="small">Student details</div>
                    <p><strong>Email</strong><br/>{textValue(detail.mappedPayload.emailAddress)}</p>
                    <p><strong>Phone</strong><br/>{textValue(detail.mappedPayload.phoneNumber)}</p>
                    <p><strong>Date of birth</strong><br/>{textValue(detail.mappedPayload.dateOfBirth)}</p>
                    <p><strong>Requested course</strong><br/>{detail.selectedCourse || '—'}</p>
                    <p><strong>Previous studies</strong><br/>{textValue(detail.mappedPayload.previousStudies)}</p>
                  </div>
                  <div className="card">
                    <div className="small">Guardian and wellbeing details</div>
                    <p><strong>Guardian</strong><br/>{textValue(detail.mappedPayload.guardianFullName)}</p>
                    <p><strong>Guardian phone</strong><br/>{textValue(detail.mappedPayload.guardianPhoneNumber)}</p>
                    <p><strong>Medical, learning or allergy notes</strong><br/>{textValue(detail.mappedPayload.medicalLearningAllergyNotes)}</p>
                  </div>
                </div>

                <div className="card" style={{ marginTop: 14 }}>
                  <div className="small">Processing</div>
                  <p><strong>Status</strong><br/><span className={`badge ${statusTone(detail.processingStatus)}`}>{label(detail.processingStatus)}</span></p>
                  <p><strong>Reason</strong><br/>{detail.processingNote || (detail.processingCode ? label(detail.processingCode) : '—')}</p>
                  <p><strong>Completed</strong><br/>{formatDate(detail.completedAt)}</p>
                  <p><strong>Received</strong><br/>{formatDate(detail.receivedAt)}</p>
                  <p><strong>Attempts</strong><br/>{detail.attemptCount}</p>
                  {detail.validationErrors.length > 0 && (
                    <p><strong>Validation issues</strong><br/>{detail.validationErrors.map(label).join(', ')}</p>
                  )}
                  {detail.applicationId && (
                    <p><strong>Linked application</strong><br/><a href="/admin/applications">{detail.applicationId}</a></p>
                  )}
                </div>

                {[
                  'course_unmatched',
                  'course_unconfigured',
                  'class_not_found',
                  'class_inactive',
                ].includes(detail.processingCode ?? '') && (
                  <div className="card" style={{ marginTop: 14 }}>
                    <div className="small">Assign requested course</div>
                    <p>
                      Link <strong>{detail.selectedCourse || 'this submitted course'}</strong> to
                      an active class, then reprocess this registration.
                    </p>
                    <div className="actions">
                      <select
                        aria-label="Class for this submitted course"
                        value={assignmentClassId}
                        disabled={pending}
                        onChange={(event) => setAssignmentClassId(event.target.value)}
                      >
                        <option value="">Choose an active class</option>
                        {classes.filter((classOption) => classOption.active).map((classOption) => (
                          <option key={classOption.id} value={classOption.id}>
                            {classOption.name}{classOption.term ? ` — ${classOption.term}` : ''}
                          </option>
                        ))}
                      </select>
                      <button
                        className="btn btn-primary"
                        disabled={pending || !assignmentClassId}
                        onClick={() => assignCourse(selected)}
                      >
                        {pendingKey === `assign:${selected.id}` ? 'Assigning…' : 'Assign & reprocess'}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}

            <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
              <button className="btn btn-outline" disabled={pending} onClick={() => { setSelected(null); setDetail(null); setAssignmentClassId(''); }}>Close</button>
              {detail && detail.processingStatus !== 'processed' && (
                <button
                  className="btn btn-primary"
                  disabled={pending}
                  onClick={() => runReprocess(selected)}
                >
                  {pendingKey === `retry:${selected.id}` ? 'Reprocessing…' : 'Reprocess'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
