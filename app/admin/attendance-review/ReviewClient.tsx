'use client';
import { useState, useTransition } from 'react';
import type { ReviewRow } from '../../../lib/live-data';
import { resolveAttendanceReview, suspendEnrolment } from '../actions/attendance-actions';

type Student = ReviewRow;

export default function ReviewClient({initialStudents}:{initialStudents:Student[]}){
  const [students,setStudents]=useState<Student[]>(initialStudents);
  const [selected,setSelected]=useState<Student|null>(null);
  const [reason,setReason]=useState('Three consecutive unexcused absences');
  const [note,setNote]=useState('');
  const [notify,setNotify]=useState(true);
  const [pending,startTransition]=useTransition();
  const isDemo=(s:Student)=>!s.enrolmentId;

  const suspend=()=>{
    if(!selected) return;
    const target=selected;
    const old=students;
    setStudents(v=>v.map(s=>s.id===target.id?{...s,status:'Suspended'}:s));
    setSelected(null);
    if(!isDemo(target)) startTransition(async()=>{
      try { await suspendEnrolment(target.enrolmentId!,reason,note,notify); }
      catch { setStudents(old); alert('The suspension could not be saved.'); }
    });
    setNote('');
  };
  const resolve=(s:Student,resolution:'excused'|'kept_enrolled')=>{
    const old=students;
    setStudents(v=>v.map(x=>x.id===s.id?{...x,status:resolution==='excused'?'Excused':'Kept enrolled'}:x));
    if(!isDemo(s)) startTransition(async()=>{
      try { await resolveAttendanceReview(s.enrolmentId!,resolution); }
      catch { setStudents(old); alert('The review could not be saved.'); }
    });
  };
  return <>
    <div className="notice"><strong>{students.filter(s=>s.status==='Review required').length} students require attendance review</strong>The system flags three consecutive unexcused absences. Suspension remains an administrator decision.</div>
    <div className="filters"><button className="filter active">Review required</button><button className="filter">2 missed — warning</button><button className="filter">Suspended</button><button className="filter">Resolved</button></div>
    <div className="table-wrap"><table><thead><tr><th>Student</th><th>Class</th><th>Absences</th><th>Attendance</th><th>Last attended</th><th>Status</th><th>Actions</th></tr></thead><tbody>{students.map(s=><tr key={`${s.id}-${s.enrolmentId ?? s.className}`}><td><strong>{s.name}</strong><br/><span className="small">{s.id}</span></td><td>{s.className}</td><td><span className="badge red">{s.missed} consecutive</span></td><td>{s.attendance}</td><td>{s.lastAttended}</td><td><span className={`badge ${s.status==='Suspended'?'red':s.status==='Review required'?'amber':'green'}`}>{s.status}</span></td><td><div className="actions"><button disabled={pending||s.status!=='Review required'} className="btn btn-danger" onClick={()=>setSelected(s)}>Suspend</button><button disabled={pending} className="btn btn-secondary" onClick={()=>resolve(s,'excused')}>Excuse</button><button disabled={pending} className="btn btn-outline" onClick={()=>resolve(s,'kept_enrolled')}>Keep enrolled</button></div></td></tr>)}</tbody></table></div>
    {selected && <div className="modal-backdrop" onClick={()=>setSelected(null)}><div className="modal" onClick={e=>e.stopPropagation()}><h3>Suspend {selected.name}?</h3><p className="subtitle">This suspends the enrolment in <strong>{selected.className}</strong>, not the student’s whole account.</p><div className="field" style={{marginTop:18}}><label>Reason</label><select value={reason} onChange={e=>setReason(e.target.value)}><option>Three consecutive unexcused absences</option><option>Behaviour</option><option>Non-payment</option><option>Administrative</option><option>Other</option></select></div><div className="field"><label>Admin note</label><textarea value={note} onChange={e=>setNote(e.target.value)} placeholder="Optional internal note"/></div><div className="field"><label><input type="checkbox" checked={notify} onChange={e=>setNotify(e.target.checked)}/> Notify student of suspension</label></div><div className="modal-footer"><button className="btn btn-outline" onClick={()=>setSelected(null)}>Cancel</button><button disabled={pending} className="btn btn-danger" onClick={suspend}>Confirm suspension</button></div></div></div>}
  </>;
}
