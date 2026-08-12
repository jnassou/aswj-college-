'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { suspendEnrolment, reinstateEnrolment } from '../actions/attendance-actions';
import { updateStudentProfile } from '../actions/student-actions';

export type StudentEnrolmentRow = {
  id: string;
  status: string;
  enrolledAt: string;
  suspendedAt: string | null;
  suspensionReason: string | null;
  className: string;
  location: string;
};

export type StudentAdminRow = {
  id: string;
  firstName: string;
  lastName: string;
  name: string;
  email: string;
  mobile: string;
  dateOfBirth: string | null;
  emergencyContactName: string;
  emergencyContactMobile: string;
  createdAt: string;
  attendanceRate: number | null;
  enrolments: StudentEnrolmentRow[];
};

function dateLabel(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function StudentsClient({ rows }: { rows: StudentAdminRow[] }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<StudentAdminRow | null>(null);
  const [editing, setEditing] = useState(false);
  const [suspendTarget, setSuspendTarget] = useState<StudentEnrolmentRow | null>(null);
  const [reason, setReason] = useState('Three consecutive unexcused absences');
  const [note, setNote] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState('');

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      [row.name, row.email, row.mobile, row.id, ...row.enrolments.map((e) => e.className)]
        .some((value) => String(value ?? '').toLowerCase().includes(q))
    );
  }, [rows, query]);

  const status = (row: StudentAdminRow) => {
    if (row.enrolments.some((e) => e.status === 'suspended')) return 'Suspended';
    if (row.enrolments.some((e) => e.status === 'enrolled')) return 'Active';
    return 'No active enrolment';
  };

  const saveProfile = (formData: FormData) => {
    if (!selected) return;
    setError('');
    startTransition(async () => {
      try {
        await updateStudentProfile(selected.id, formData);
        setEditing(false);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'The student profile could not be updated.');
      }
    });
  };

  const suspend = () => {
    if (!suspendTarget) return;
    setError('');
    startTransition(async () => {
      try {
        await suspendEnrolment(suspendTarget.id, reason, note, true);
        setSuspendTarget(null);
        setNote('');
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'The enrolment could not be suspended.');
      }
    });
  };

  const reinstate = (enrolment: StudentEnrolmentRow) => {
    if (!window.confirm(`Reinstate this student into ${enrolment.className}?`)) return;
    startTransition(async () => {
      try {
        await reinstateEnrolment(enrolment.id, 'Reinstated from student profile');
        router.refresh();
      } catch (err) {
        window.alert(err instanceof Error ? err.message : 'The enrolment could not be reinstated.');
      }
    });
  };

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Students</h1>
          <p className="subtitle">Search student records, enrolments, attendance and suspension status.</p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="field" style={{ marginBottom: 0, maxWidth: 520 }}>
          <label>Search students</label>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, student ID, mobile, email or class"
          />
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Student</th>
              <th>Mobile</th>
              <th>Current classes</th>
              <th>Attendance</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr><td colSpan={6}><span className="small">No students match this search.</span></td></tr>
            ) : visible.map((row) => {
              const state = status(row);
              return (
                <tr key={row.id}>
                  <td><strong>{row.name}</strong><br/><span className="small">{row.email || row.id}</span></td>
                  <td>{row.mobile || '—'}</td>
                  <td>{row.enrolments.filter((e) => ['enrolled','suspended'].includes(e.status)).length}</td>
                  <td>{row.attendanceRate === null ? '—' : `${row.attendanceRate}%`}</td>
                  <td><span className={`badge ${state === 'Suspended' ? 'red' : state === 'Active' ? 'green' : 'grey'}`}>{state}</span></td>
                  <td><button className="btn btn-outline" onClick={() => { setSelected(row); setEditing(false); setError(''); }}>Open profile</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="modal-backdrop" onMouseDown={() => !pending && setSelected(null)}>
          <div className="modal" onMouseDown={(e) => e.stopPropagation()} style={{ width: 'min(760px,100%)', maxHeight: '92vh', overflow: 'auto' }}>
            <div className="section-head">
              <div>
                <h3>{selected.name}</h3>
                <p className="subtitle">{selected.email || 'No email'}</p>
              </div>
              <button className="btn btn-outline" onClick={() => setEditing((v) => !v)}>{editing ? 'Cancel edit' : 'Edit profile'}</button>
            </div>

            {error && <div className="notice">{error}</div>}

            {editing ? (
              <form action={saveProfile}>
                <div className="form-row">
                  <div className="field"><label>First name</label><input name="first_name" required defaultValue={selected.firstName}/></div>
                  <div className="field"><label>Last name</label><input name="last_name" required defaultValue={selected.lastName}/></div>
                </div>
                <div className="form-row">
                  <div className="field"><label>Mobile</label><input name="mobile" defaultValue={selected.mobile}/></div>
                  <div className="field"><label>Date of birth</label><input name="date_of_birth" type="date" defaultValue={selected.dateOfBirth ?? ''}/></div>
                </div>
                <div className="form-row">
                  <div className="field"><label>Emergency contact</label><input name="emergency_contact_name" defaultValue={selected.emergencyContactName}/></div>
                  <div className="field"><label>Emergency mobile</label><input name="emergency_contact_mobile" defaultValue={selected.emergencyContactMobile}/></div>
                </div>
                <div className="modal-footer">
                  <button className="btn btn-primary" type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save profile'}</button>
                </div>
              </form>
            ) : (
              <div className="portal-grid">
                <section className="card">
                  <div className="small">Student details</div>
                  <p><strong>Mobile</strong><br/>{selected.mobile || '—'}</p>
                  <p><strong>Date of birth</strong><br/>{dateLabel(selected.dateOfBirth)}</p>
                  <p><strong>Emergency contact</strong><br/>{selected.emergencyContactName || '—'}{selected.emergencyContactMobile ? ` · ${selected.emergencyContactMobile}` : ''}</p>
                  <p><strong>Student since</strong><br/>{dateLabel(selected.createdAt)}</p>
                </section>
                <section className="card">
                  <div className="small">Overall attendance</div>
                  <div className="metric-value">{selected.attendanceRate === null ? '—' : `${selected.attendanceRate}%`}</div>
                  <p className="small">Across current enrolled and suspended classes.</p>
                </section>
              </div>
            )}

            <div className="section" style={{ marginTop: 18 }}>
              <div className="section-head"><h2>Enrolments</h2></div>
              {selected.enrolments.length === 0 ? (
                <p className="subtitle">No enrolments yet.</p>
              ) : selected.enrolments.map((enrolment) => (
                <div className="card" key={enrolment.id} style={{ marginBottom: 10 }}>
                  <div className="section-head">
                    <div>
                      <strong>{enrolment.className}</strong>
                      <div className="small">{enrolment.location || 'No location set'} · Enrolled {dateLabel(enrolment.enrolledAt)}</div>
                    </div>
                    <span className={`badge ${enrolment.status === 'suspended' ? 'red' : enrolment.status === 'enrolled' ? 'green' : 'grey'}`}>{enrolment.status}</span>
                  </div>
                  {enrolment.suspensionReason && <p className="small">Suspension reason: {enrolment.suspensionReason}</p>}
                  <div className="actions">
                    {enrolment.status === 'enrolled' && (
                      <button className="btn btn-danger" onClick={() => { setSuspendTarget(enrolment); setReason('Three consecutive unexcused absences'); setNote(''); }}>Suspend</button>
                    )}
                    {enrolment.status === 'suspended' && (
                      <button className="btn btn-primary" disabled={pending} onClick={() => reinstate(enrolment)}>Reinstate</button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setSelected(null)} disabled={pending}>Close</button>
            </div>
          </div>
        </div>
      )}

      {suspendTarget && (
        <div className="modal-backdrop" style={{ zIndex: 20 }} onMouseDown={() => !pending && setSuspendTarget(null)}>
          <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
            <h3>Suspend enrolment</h3>
            <p className="subtitle">{suspendTarget.className}</p>
            {error && <div className="notice" style={{ marginTop: 16 }}>{error}</div>}
            <div className="field" style={{ marginTop: 16 }}>
              <label>Reason</label>
              <input value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            <div className="field">
              <label>Admin note</label>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional internal note" />
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setSuspendTarget(null)} disabled={pending}>Cancel</button>
              <button className="btn btn-danger" onClick={suspend} disabled={pending || !reason.trim()}>{pending ? 'Suspending…' : 'Suspend student'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
