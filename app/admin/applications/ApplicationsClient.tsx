'use client';
import { useState, useTransition } from 'react';
import { decideApplication } from '../actions/application-actions';
import type { ApplicationRow } from '../../../lib/live-data';

export default function ApplicationsClient({initialRows}:{initialRows:ApplicationRow[]}){
 const [rows,setRows]=useState(initialRows);
 const [pending,startTransition]=useTransition();
 const change=(id:string,status:'Accepted'|'Waitlisted'|'Declined')=>{
   const old = rows;
   setRows(r=>r.map(x=>x.id===id?{...x,status}:x));
   if (!id.startsWith('APP-')) startTransition(async()=>{
     try { await decideApplication(id,status.toLowerCase() as 'accepted'|'waitlisted'|'declined'); }
     catch { setRows(old); alert('The application could not be updated.'); }
   });
 };
 return <><div className="filters"><button className="filter active">All</button><button className="filter">Pending</button><button className="filter">Accepted</button><button className="filter">Waitlisted</button><button className="filter">Declined</button></div><div className="table-wrap"><table><thead><tr><th>Applicant</th><th>Class</th><th>Submitted</th><th>Status</th><th>Actions</th></tr></thead><tbody>{rows.map(a=><tr key={a.id}><td><strong>{a.name}</strong><br/><span className="small">{a.id}</span></td><td>{a.className}</td><td>{a.submitted}</td><td><span className={`badge ${a.status==='Pending'?'amber':a.status==='Accepted'?'green':a.status==='Declined'?'red':'blue'}`}>{a.status}</span></td><td><div className="actions"><button disabled={pending} className="btn btn-primary" onClick={()=>change(a.id,'Accepted')}>Accept</button><button disabled={pending} className="btn btn-secondary" onClick={()=>change(a.id,'Waitlisted')}>Waitlist</button><button disabled={pending} className="btn btn-outline" onClick={()=>change(a.id,'Declined')}>Decline</button></div></td></tr>)}</tbody></table></div></>
}
