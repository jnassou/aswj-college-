'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  ApplicationDecision,
  ApplicationRegistrationDetails,
  decideApplication,
  getApplicationRegistrationDetails,
} from '../actions/application-actions';

export type ApplicationAdminRow = {
  id: string;
  studentId: string;
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  mobile: string;
  dateOfBirth: string | null;
  emergencyContactName: string;
  emergencyContactMobile: string;
  classId: string;
  className: string;
  classCapacity: number;
  classEnrolled: number;
  classActive: boolean;
  status: string;
  waitlistPosition: number | null;
  source: string;
  externalResponseId: string;
  submittedAt: string;
  reviewedAt: string | null;
  adminNotes: string;
};

const FILTERS = ['all', 'pending', 'accepted', 'waitlisted', 'declined'] as const;

function statusLabel(value: string) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1).replaceAll('_', ' ') : 'Unknown';
}

function badgeClass(value: string) {
  if (value === 'accepted') return 'green';
  if (value === 'pending') return 'amber';
  if (value === 'declined') return 'red';
  if (value === 'waitlisted') return 'blue';
  return 'grey';
}

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export default function ApplicationsClient({ rows }: { rows: ApplicationAdminRow[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('pending');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ApplicationAdminRow | null>(null);
  const [registrationDetails, setRegistrationDetails] = useState<ApplicationRegistrationDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState('');
  const [note, setNote] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState('');
  const detailRequest = useRef(0);

  const counts = useMemo(() => {
    const result: Record<string, number> = { all: rows.length };
    for (const row of rows) result[row.status] = (result[row.status] ?? 0) + 1;
    return result;
  }, [rows]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (filter !== 'all' && row.status !== filter) return false;
      if (!q) return true;
      return [
        row.name,
        row.email,
        row.mobile,
        row.className,
        row.id,
        row.externalResponseId,
      ].some((value) => String(value ?? '').toLowerCase().includes(q));
    });
  }, [rows, filter, query]);

  const open = (row: ApplicationAdminRow) => {
    const request = detailRequest.current + 1;
    detailRequest.current = request;
    setSelected(row);
    setNote(row.adminNotes);
    setError('');
    setRegistrationDetails(null);
    setDetailsError('');
    setDetailsLoading(true);

    void getApplicationRegistrationDetails(row.id)
      .then((details) => {
        if (detailRequest.current === request) setRegistrationDetails(details);
      })
      .catch(() => {
        if (detailRequest.current === request) {
          setDetailsError('Registration details could not be loaded.');
        }
      })
      .finally(() => {
        if (detailRequest.current === request) setDetailsLoading(false);
      });
  };

  const close = () => {
    if (pending) return;
    detailRequest.current += 1;
    setSelected(null);
    setRegistrationDetails(null);
    setDetailsLoading(false);
    setDetailsError('');
  };

  const decide = (decision: ApplicationDecision) => {
    if (!selected) return;
    setError('');

    startTransition(async () => {
      try {
        await decideApplication(selected.id, decision, note);
        setSelected(null);
        setNote('');
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'The application could not be updated.');
      }
    });
  };

  return (
    <>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="form-row" style={{ alignItems: 'end' }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Search applications</label>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Name, email, mobile, class or response ID"
            />
          </div>
          <div className="small">
            Showing {visible.length} of {rows.length} applications
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
            {statusLabel(item)} ({counts[item] ?? 0})
          </button>
        ))}
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Applicant</th>
              <th>Class</th>
              <th>Submitted</th>
              <th>Status</th>
              <th>Class places</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={6}><span className="small">No applications match this view.</span></td>
              </tr>
            ) : visible.map((row) => (
              <tr key={row.id}>
                <td>
                  <strong>{row.name}</strong><br/>
                  <span className="small">{row.email || row.mobile || row.id}</span>
                </td>
                <td>{row.className}</td>
                <td>{formatDate(row.submittedAt)}</td>
                <td>
                  <span className={`badge ${badgeClass(row.status)}`}>
                    {statusLabel(row.status)}
                    {row.status === 'waitlisted' && row.waitlistPosition ? ` #${row.waitlistPosition}` : ''}
                  </span>
                </td>
                <td>{row.classEnrolled} / {row.classCapacity}</td>
                <td><button className="btn btn-outline" onClick={() => open(row)}>Review</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="modal-backdrop" onMouseDown={close}>
          <div className="modal" onMouseDown={(event) => event.stopPropagation()} style={{ width: 'min(680px,100%)', maxHeight: '92vh', overflow: 'auto' }}>
            <h3>{selected.name}</h3>
            <p className="subtitle">{selected.className}</p>

            {error && <div className="notice" style={{ marginTop: 16 }}>{error}</div>}

            <div className="portal-grid" style={{ marginTop: 18 }}>
              <div className="card">
                <div className="small">Applicant details</div>
                <p><strong>Email</strong><br/>{selected.email || '—'}</p>
                <p><strong>Mobile</strong><br/>{selected.mobile || '—'}</p>
                <p><strong>Date of birth</strong><br/>{formatDate(selected.dateOfBirth)}</p>
                <p><strong>Emergency contact</strong><br/>{selected.emergencyContactName || '—'}{selected.emergencyContactMobile ? ` · ${selected.emergencyContactMobile}` : ''}</p>
              </div>
              <div className="card">
                <div className="small">Application</div>
                <p><strong>Status</strong><br/><span className={`badge ${badgeClass(selected.status)}`}>{statusLabel(selected.status)}</span></p>
                <p><strong>Submitted</strong><br/>{formatDate(selected.submittedAt)}</p>
                <p><strong>Source</strong><br/>{selected.source}</p>
                {selected.externalResponseId && <p><strong>External response</strong><br/>{selected.externalResponseId}</p>}
                <p><strong>Class capacity</strong><br/>{selected.classEnrolled} / {selected.classCapacity}</p>
              </div>
            </div>

            <div className="card" style={{ marginTop: 14 }}>
              <div className="small">Submitted registration details</div>
              {detailsLoading ? (
                <p>Loading protected details…</p>
              ) : detailsError ? (
                <p style={{ color: 'var(--danger)' }}>{detailsError}</p>
              ) : registrationDetails ? (
                <div className="portal-grid">
                  <div>
                    <p><strong>Submitted student name</strong><br/>{registrationDetails.studentFirstName} {registrationDetails.studentLastName}</p>
                    <p><strong>Confirmed email</strong><br/>{registrationDetails.emailAddress}</p>
                    <p><strong>Phone</strong><br/>{registrationDetails.phoneNumber}</p>
                    <p><strong>Date of birth</strong><br/>{formatDate(registrationDetails.dateOfBirth)}</p>
                    <p><strong>Guardian</strong><br/>{registrationDetails.guardianFullName || '—'}{registrationDetails.guardianPhoneNumber ? ` · ${registrationDetails.guardianPhoneNumber}` : ''}</p>
                    <p><strong>WhatsApp consent</strong><br/>{registrationDetails.whatsappOptIn ? 'Yes' : 'No'}</p>
                  </div>
                  <div>
                    <p><strong>Medical, learning or allergy notes</strong><br/><span style={{ whiteSpace: 'pre-wrap' }}>{registrationDetails.medicalLearningAllergyNotes || '—'}</span></p>
                    <p><strong>Previous studies</strong><br/><span style={{ whiteSpace: 'pre-wrap' }}>{registrationDetails.previousStudies || '—'}</span></p>
                    <p className="small">Privacy notice {registrationDetails.privacyNoticeVersion} accepted {formatDate(registrationDetails.consentedAt)}</p>
                  </div>
                </div>
              ) : (
                <p className="small">No native registration snapshot is attached to this application.</p>
              )}
            </div>

            <div className="field" style={{ marginTop: 18 }}>
              <label>Admin notes</label>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Internal review notes"
              />
            </div>

            <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
              <button className="btn btn-outline" disabled={pending} onClick={close}>Close</button>
              <div className="actions">
                <button className="btn btn-outline" disabled={pending} onClick={() => decide('declined')}>Decline</button>
                <button className="btn btn-secondary" disabled={pending} onClick={() => decide('waitlisted')}>Waitlist</button>
                <button className="btn btn-primary" disabled={pending || !selected.classActive} onClick={() => decide('accepted')}>
                  {pending ? 'Saving…' : 'Accept'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
