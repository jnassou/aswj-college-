'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createClass, setClassActive, updateClass } from '../actions/class-actions';
import {
  CLASS_TIME_OPTIONS,
  DEFAULT_CLASS_END_TIME,
  DEFAULT_CLASS_START_TIME,
  formatClassTime,
} from '../../../lib/class-time';

export type ClassRow = {
  id: string;
  name: string;
  term: string | null;
  teacher_id: string | null;
  teacher_name: string | null;
  location: string | null;
  capacity: number;
  enrolled: number;
  absence_threshold: number;
  registration_enabled: boolean;
  registration_opens_at: string | null;
  registration_closes_at: string | null;
  starts_on: string | null;
  ends_on: string | null;
  day_of_week: number | null;
  start_time: string | null;
  end_time: string | null;
  active: boolean;
};

export type TeacherOption = {
  id: string;
  name: string;
  role: string;
};

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function shortTime(value: string | null) {
  return value ? value.slice(0, 5) : '';
}

function scheduleLabel(row: ClassRow) {
  const parts: string[] = [];
  if (row.day_of_week !== null) parts.push(DAYS[row.day_of_week]);
  if (row.start_time) {
    parts.push(
      formatClassTime(row.start_time) +
      (row.end_time ? `–${formatClassTime(row.end_time)}` : '')
    );
  }
  return parts.length ? parts.join(' ') : 'Not set';
}

function timeOptions(currentValue: string) {
  if (!currentValue || CLASS_TIME_OPTIONS.some((option) => option.value === currentValue)) {
    return CLASS_TIME_OPTIONS;
  }

  return [
    ...CLASS_TIME_OPTIONS,
    { value: currentValue, label: formatClassTime(currentValue) },
  ].sort((a, b) => a.value.localeCompare(b.value));
}

function localDateTime(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 16);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export default function ClassesClient({
  rows,
  teachers,
}: {
  rows: ClassRow[];
  teachers: TeacherOption[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<ClassRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState('');

  const visibleRows = useMemo(
    () => rows.filter((row) => showArchived || row.active),
    [rows, showArchived]
  );
  const startTimeValue = selected
    ? shortTime(selected.start_time)
    : DEFAULT_CLASS_START_TIME;
  const endTimeValue = selected
    ? shortTime(selected.end_time)
    : DEFAULT_CLASS_END_TIME;

  const closeModal = () => {
    if (pending) return;
    setCreating(false);
    setSelected(null);
    setError('');
  };

  const save = (formData: FormData) => {
    setError('');
    startTransition(async () => {
      try {
        if (selected) await updateClass(selected.id, formData);
        else await createClass(formData);
        setCreating(false);
        setSelected(null);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'The class could not be saved.');
      }
    });
  };

  const toggleActive = (row: ClassRow) => {
    const action = row.active ? 'archive' : 'reactivate';
    if (!window.confirm(`Are you sure you want to ${action} ${row.name}?`)) return;

    startTransition(async () => {
      try {
        await setClassActive(row.id, !row.active);
        router.refresh();
      } catch (err) {
        window.alert(err instanceof Error ? err.message : 'The class status could not be changed.');
      }
    });
  };

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Classes</h1>
          <p className="subtitle">Create classes, manage capacity, schedules and attendance rules.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          Create class
        </button>
      </div>

      <div className="filters">
        <button className={`filter ${!showArchived ? 'active' : ''}`} onClick={() => setShowArchived(false)}>
          Active
        </button>
        <button className={`filter ${showArchived ? 'active' : ''}`} onClick={() => setShowArchived(true)}>
          All classes
        </button>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Class</th>
              <th>Enrolled</th>
              <th>Schedule</th>
              <th>Teacher</th>
              <th>Location</th>
              <th>Absence rule</th>
              <th>Portal applications</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr><td colSpan={9}><span className="small">No classes created yet.</span></td></tr>
            ) : visibleRows.map((row) => (
              <tr key={row.id}>
                <td><strong>{row.name}</strong><br/><span className="small">{row.term || 'No term set'}</span></td>
                <td>{row.enrolled} / {row.capacity}</td>
                <td>{scheduleLabel(row)}</td>
                <td>{row.teacher_name || 'Unassigned'}</td>
                <td>{row.location || '—'}</td>
                <td>{row.absence_threshold} consecutive</td>
                <td>
                  <span className={`badge ${row.registration_enabled ? 'blue' : 'grey'}`}>
                    {row.registration_enabled ? 'Allowed' : 'Not allowed'}
                  </span>
                </td>
                <td><span className={`badge ${row.active ? 'green' : 'grey'}`}>{row.active ? 'Active' : 'Archived'}</span></td>
                <td>
                  <div className="actions">
                    <button className="btn btn-outline" onClick={() => setSelected(row)}>Edit</button>
                    <button className={row.active ? 'btn btn-secondary' : 'btn btn-primary'} disabled={pending} onClick={() => toggleActive(row)}>
                      {row.active ? 'Archive' : 'Reactivate'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(creating || selected) && (
        <div className="modal-backdrop" onMouseDown={closeModal}>
          <div className="modal" onMouseDown={(e) => e.stopPropagation()} style={{maxHeight:'90vh', overflow:'auto'}}>
            <h3>{selected ? 'Edit class' : 'Create class'}</h3>
            <p className="subtitle">These settings will drive registration, enrolment and attendance.</p>
            {error && <div className="notice" style={{marginTop:16}}>{error}</div>}

            <form action={save} style={{marginTop:18}}>
              <div className="field">
                <label>Class name</label>
                <input name="name" required defaultValue={selected?.name ?? ''} />
              </div>

              <div className="form-row">
                <div className="field">
                  <label>Term</label>
                  <input name="term" placeholder="e.g. Term 3, 2026" defaultValue={selected?.term ?? ''} />
                </div>
                <div className="field">
                  <label>Location</label>
                  <input name="location" placeholder="e.g. Revesby" defaultValue={selected?.location ?? ''} />
                </div>
              </div>

              <div className="field">
                <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input
                    name="registration_enabled"
                    type="checkbox"
                    defaultChecked={selected?.registration_enabled ?? false}
                    style={{ width: 'auto' }}
                  />
                  Allow Student Portal applications
                </label>
                <span className="small">
                  Students can apply only while this class is active and within any registration dates set below.
                </span>
              </div>

              <div className="form-row">
                <div className="field">
                  <label>Teacher</label>
                  <select name="teacher_id" defaultValue={selected?.teacher_id ?? ''}>
                    <option value="">Unassigned</option>
                    {teachers.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.name}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Capacity</label>
                  <input name="capacity" type="number" min="1" required defaultValue={selected?.capacity ?? 30} />
                </div>
              </div>

              <div className="form-row">
                <div className="field">
                  <label>Day</label>
                  <select name="day_of_week" defaultValue={selected?.day_of_week ?? ''}>
                    <option value="">Not set</option>
                    {DAYS.map((day, index) => <option key={day} value={index}>{day}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Consecutive absence threshold</label>
                  <input name="absence_threshold" type="number" min="1" required defaultValue={selected?.absence_threshold ?? 3} />
                </div>
              </div>

              <div className="form-row">
                <div className="field">
                  <label>Start time</label>
                  <select name="start_time" defaultValue={startTimeValue}>
                    <option value="">Not set</option>
                    {timeOptions(startTimeValue).map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>End time</label>
                  <select name="end_time" defaultValue={endTimeValue}>
                    <option value="">Not set</option>
                    {timeOptions(endTimeValue).map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-row">
                <div className="field">
                  <label>Class starts</label>
                  <input name="starts_on" type="date" defaultValue={selected?.starts_on ?? ''} />
                </div>
                <div className="field">
                  <label>Class ends</label>
                  <input name="ends_on" type="date" defaultValue={selected?.ends_on ?? ''} />
                </div>
              </div>

              <div className="form-row">
                <div className="field">
                  <label>Registration opens</label>
                  <input name="registration_opens_at" type="datetime-local" defaultValue={localDateTime(selected?.registration_opens_at ?? null)} />
                </div>
                <div className="field">
                  <label>Registration closes</label>
                  <input name="registration_closes_at" type="datetime-local" defaultValue={localDateTime(selected?.registration_closes_at ?? null)} />
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-outline" onClick={closeModal} disabled={pending}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? 'Saving…' : selected ? 'Save changes' : 'Create class'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
