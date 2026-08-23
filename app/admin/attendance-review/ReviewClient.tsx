'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  reinstateEnrolment,
  resolveAttendanceReview,
  suspendEnrolment,
} from '../actions/attendance-actions';
import { useAdminDialog } from '../useAdminDialog';

export type AttendanceReviewRow = {
  id: string;
  name: string;
  contact: string;
  className: string;
  missed: number;
  threshold: number;
  state: string;
  reason?: string;
};

const FILTERS = [
  ['review_required', 'Review required'],
  ['warning', 'Warning'],
  ['suspended', 'Suspended'],
  ['all', 'All'],
];

export default function ReviewClient({ rows }: { rows: AttendanceReviewRow[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState('review_required');
  const [selected, setSelected] = useState<AttendanceReviewRow | null>(null);
  const [note, setNote] = useState('');
  const [pending, startTransition] = useTransition();
  const counts = useMemo(
    () => rows.reduce((result: Record<string, number>, row) => {
      result[row.state] = (result[row.state] ?? 0) + 1;
      return result;
    }, {}),
    [rows]
  );
  const visible = filter === 'all' ? rows : rows.filter((row) => row.state === filter);

  const run = (action: () => Promise<void>) => startTransition(async () => {
    try {
      await action();
      setSelected(null);
      setNote('');
      router.refresh();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Action failed.');
    }
  });
  const dialogRef = useAdminDialog<HTMLDivElement>({
    open: selected !== null,
    onClose: () => {
      if (!pending) setSelected(null);
    },
  });

  return (
    <>
      <div className="notice" role="status">
        <strong>{counts.review_required ?? 0} students require review</strong>
        Students are flagged automatically at the class absence threshold. Suspension remains an administrator decision.
      </div>

      <div className="filters" role="group" aria-label="Attendance review status filters">
        {FILTERS.map(([key, label]) => (
          <button
            key={key}
            className={`filter ${filter === key ? 'active' : ''}`}
            type="button"
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
          >
            {label} ({key === 'all' ? rows.length : counts[key] ?? 0})
          </button>
        ))}
      </div>

      <div className="table-wrap" role="region" aria-label="Attendance reviews" tabIndex={0}>
        <table>
          <thead>
            <tr>
              <th>Student</th>
              <th>Class</th>
              <th>Misses</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr><td colSpan={5}><span className="small">No students in this view.</span></td></tr>
            ) : visible.map((row) => (
              <tr key={`${row.state}-${row.id}`}>
                <td><strong>{row.name}</strong><br/><span className="small">{row.contact}</span></td>
                <td>{row.className}</td>
                <td>{row.state === 'suspended' ? '—' : `${row.missed} / ${row.threshold}`}</td>
                <td>
                  <span className={`badge ${row.state === 'review_required' ? 'amber' : row.state === 'warning' ? 'blue' : 'red'}`}>
                    {row.state === 'review_required' ? 'Review required' : row.state === 'warning' ? 'Warning' : 'Suspended'}
                  </span>
                </td>
                <td>
                  <div className="actions">
                    {row.state === 'review_required' && (
                      <>
                        <button className="btn btn-danger" type="button" onClick={() => setSelected(row)}>Suspend</button>
                        <button className="btn btn-secondary" type="button" disabled={pending} onClick={() => run(() => resolveAttendanceReview(row.id, 'excused', 'Latest absence excused'))}>Excuse latest</button>
                        <button className="btn btn-outline" type="button" disabled={pending} onClick={() => run(() => resolveAttendanceReview(row.id, 'kept_enrolled', 'Kept enrolled after review'))}>Keep enrolled</button>
                      </>
                    )}
                    {row.state === 'suspended' && (
                      <button className="btn btn-primary" type="button" disabled={pending} onClick={() => run(() => reinstateEnrolment(row.id, 'Reinstated from attendance review'))}>Reinstate</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="modal-backdrop">
          <div
            ref={dialogRef}
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="attendance-suspension-title"
            tabIndex={-1}
          >
            <h3 id="attendance-suspension-title">Suspend {selected.name}?</h3>
            <p className="subtitle">This suspends only the enrolment in <strong>{selected.className}</strong>.</p>
            <div className="field" style={{ marginTop: 16 }}>
              <label htmlFor="attendance-suspension-note">Admin note</label>
              <textarea id="attendance-suspension-note" value={note} onChange={(event) => setNote(event.target.value)} />
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" type="button" onClick={() => setSelected(null)}>Cancel</button>
              <button
                className="btn btn-danger"
                type="button"
                disabled={pending}
                onClick={() => run(() => suspendEnrolment(selected.id, 'Three consecutive unexcused absences', note, true))}
              >
                Confirm suspension
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
