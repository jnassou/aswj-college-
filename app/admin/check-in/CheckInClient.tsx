'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { checkInByQr, setManualAttendance } from '../actions/checkin-actions';

export type CheckInStudent = {
  enrolmentId: string;
  studentId: string;
  name: string;
  enrolmentStatus: string;
  attendanceStatus: string | null;
  checkedInAt: string | null;
};

export type CheckInClass = {
  id: string;
  name: string;
  location: string;
  startTime: string;
  endTime: string;
  sessionId: string | null;
  sessionCancelled: boolean;
  students: CheckInStudent[];
};

function badge(status: string | null) {
  if (status === 'present') return 'green';
  if (status === 'late') return 'blue';
  if (status === 'absent' || status === 'absent_unexcused') return 'red';
  if (status === 'excused' || status === 'absent_excused') return 'grey';
  return 'amber';
}

export default function CheckInClient({ classes, today }: { classes: CheckInClass[]; today: string }) {
  const router = useRouter();
  const [classId, setClassId] = useState(classes[0]?.id ?? '');
  const [scannerOn, setScannerOn] = useState(false);
  const [manualToken, setManualToken] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanLock = useRef(false);

  const selected = useMemo(() => classes.find((c) => c.id === classId) ?? null, [classes, classId]);

  const stopScanner = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setScannerOn(false);
    scanLock.current = false;
  };

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const processToken = (raw: string) => {
    if (!classId || pending || scanLock.current) return;
    scanLock.current = true;
    setError('');
    setMessage('');

    startTransition(async () => {
      try {
        const result = await checkInByQr(classId, raw);
        setMessage(`${result.name} checked in successfully.`);
        setManualToken('');
        router.refresh();
        window.setTimeout(() => { scanLock.current = false; }, 1400);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'The QR code could not be processed.');
        window.setTimeout(() => { scanLock.current = false; }, 1800);
      }
    });
  };

  const startScanner = async () => {
    setError('');
    setMessage('');

    try {
      const Detector = (window as any).BarcodeDetector;
      if (!Detector) {
        setError('This browser does not provide built-in QR scanning. Use the manual token box below or open this page in Chrome/Edge on a supported device.');
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });

      streamRef.current = stream;
      setScannerOn(true);

      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();

      const detector = new Detector({ formats: ['qr_code'] });

      const scan = async () => {
        if (!streamRef.current || !videoRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          const value = codes?.[0]?.rawValue;
          if (value && !scanLock.current) processToken(value);
        } catch {}
        if (streamRef.current) requestAnimationFrame(scan);
      };

      requestAnimationFrame(scan);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Camera access could not be started.');
      stopScanner();
    }
  };

  const manualAttendance = (student: CheckInStudent, status: 'present'|'late'|'absent'|'excused') => {
    if (!selected) return;
    startTransition(async () => {
      try {
        await setManualAttendance(student.enrolmentId, selected.id, status);
        router.refresh();
      } catch (err) {
        window.alert(err instanceof Error ? err.message : 'Attendance could not be saved.');
      }
    });
  };

  return (
    <>
      <div className="topbar">
        <div>
          <h1>QR Check-in</h1>
          <p className="subtitle">Scan student QR codes and manage today’s attendance — {today}.</p>
        </div>
      </div>

      <section className="card">
        <div className="form-row">
          <div className="field">
            <label>Select class</label>
            <select value={classId} onChange={(e) => { stopScanner(); setClassId(e.target.value); setMessage(''); setError(''); }}>
              {classes.length === 0 && <option value="">No active classes</option>}
              {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            {selected && (
              <div className="small" style={{ paddingTop: 24 }}>
                {selected.location || 'No location set'}
                {selected.startTime && ` · ${selected.startTime}${selected.endTime ? `–${selected.endTime}` : ''}`}
                {' · '}{selected.students.filter((s) => s.attendanceStatus === 'present' || s.attendanceStatus === 'late').length}/{selected.students.filter((s) => s.enrolmentStatus === 'enrolled').length} checked in
              </div>
            )}
          </div>
        </div>

        {error && <div className="notice">{error}</div>}
        {message && <div className="card" style={{ background: 'var(--brand-soft)', borderColor: 'var(--brand)', marginBottom: 16 }}><strong>{message}</strong></div>}

        {selected?.sessionCancelled ? (
          <div className="notice"><strong>Session cancelled</strong>Attendance cannot be recorded for this class today.</div>
        ) : (
          <>
            <div style={{ border:'2px dashed var(--line)', borderRadius:14, padding:18, textAlign:'center' }}>
              <video ref={videoRef} playsInline muted style={{ display: scannerOn ? 'block' : 'none', width:'100%', maxWidth:560, margin:'0 auto 14px', borderRadius:12 }} />
              {!scannerOn && <><strong>Camera QR scanner</strong><p className="small">The student presents their ASWJ College Student Portal QR code.</p></>}
              <div className="actions" style={{ justifyContent:'center' }}>
                {!scannerOn ? (
                  <button className="btn btn-primary" disabled={!selected} onClick={startScanner}>Start scanner</button>
                ) : (
                  <button className="btn btn-outline" onClick={stopScanner}>Stop scanner</button>
                )}
              </div>
            </div>

            <div className="field" style={{ maxWidth:560, margin:'18px auto 0' }}>
              <label>Manual QR token fallback</label>
              <div className="actions">
                <input style={{ flex:1 }} value={manualToken} onChange={(e) => setManualToken(e.target.value)} placeholder="Paste or type QR token" />
                <button className="btn btn-primary" disabled={!manualToken.trim() || pending} onClick={() => processToken(manualToken)}>Check in</button>
              </div>
              <span className="small">Use this if camera scanning is unavailable.</span>
            </div>
          </>
        )}
      </section>

      {selected && (
        <section className="section">
          <div className="section-head">
            <div><h2>Today’s roll</h2><div className="small">{selected.name}</div></div>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Student</th><th>Enrolment</th><th>Attendance</th><th>Manual action</th></tr></thead>
              <tbody>
                {selected.students.length === 0 ? (
                  <tr><td colSpan={4}><span className="small">No students are enrolled in this class.</span></td></tr>
                ) : selected.students.map((student) => (
                  <tr key={student.enrolmentId}>
                    <td><strong>{student.name}</strong></td>
                    <td><span className={`badge ${student.enrolmentStatus === 'suspended' ? 'red' : 'green'}`}>{student.enrolmentStatus}</span></td>
                    <td><span className={`badge ${badge(student.attendanceStatus)}`}>{student.attendanceStatus === 'absent_unexcused' ? 'Absent' : student.attendanceStatus === 'absent_excused' ? 'Excused' : student.attendanceStatus ?? 'Not marked'}</span></td>
                    <td>
                      {student.enrolmentStatus === 'suspended' ? <span className="small">Suspended</span> : (
                        <div className="actions">
                          <button disabled={pending} className="btn btn-primary" onClick={() => manualAttendance(student,'present')}>Present</button>
                          <button disabled={pending} className="btn btn-secondary" onClick={() => manualAttendance(student,'late')}>Late</button>
                          <button disabled={pending} className="btn btn-outline" onClick={() => manualAttendance(student,'excused')}>Excused</button>
                          <button disabled={pending} className="btn btn-outline" onClick={() => manualAttendance(student,'absent')}>Absent</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
