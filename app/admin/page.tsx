import { getApplications, getAttendanceReviews, getDashboardMetrics } from '../../lib/live-data';

export default async function AdminDashboard() {
  const [dashboardMetrics, applications, reviewStudents] = await Promise.all([
    getDashboardMetrics(), getApplications(), getAttendanceReviews()
  ]);
  return <>
    <div className="topbar"><div><h1>ASWJ College Admin</h1><p className="subtitle">Registration, attendance, waitlists and student compliance.</p></div><div className="user-pill">Administrator</div></div>
    <div className="grid">{dashboardMetrics.map(([label,value,tone]) => <section className="card" key={label}><div className="metric-label">{label}</div><div className={`metric-value ${tone}`}>{value}</div></section>)}</div>
    <section className="section"><div className="section-head"><div><h2>Attendance action required</h2><div className="small">Students who have reached the consecutive absence threshold.</div></div><a className="btn btn-outline" href="/admin/attendance-review">View all</a></div>
      <div className="table-wrap"><table><thead><tr><th>Student</th><th>Class</th><th>Consecutive absences</th><th>Last attended</th><th>Action</th></tr></thead><tbody>{reviewStudents.slice(0,3).map(s=><tr key={`${s.id}-${s.enrolmentId ?? s.className}`}><td><strong>{s.name}</strong><br/><span className="small">{s.id}</span></td><td>{s.className}</td><td><span className="badge red">{s.missed} missed</span></td><td>{s.lastAttended}</td><td><a className="btn btn-primary" href="/admin/attendance-review">Review</a></td></tr>)}</tbody></table></div>
    </section>
    <section className="section"><div className="section-head"><div><h2>Recent applications</h2><div className="small">New and recently processed registrations.</div></div><a className="btn btn-outline" href="/admin/applications">Process applications</a></div>
      <div className="table-wrap"><table><thead><tr><th>Applicant</th><th>Class</th><th>Submitted</th><th>Status</th></tr></thead><tbody>{applications.slice(0,8).map(a=><tr key={a.id}><td><strong>{a.name}</strong><br/><span className="small">{a.id}</span></td><td>{a.className}</td><td>{a.submitted}</td><td><span className={`badge ${a.status==='Pending'?'amber':a.status==='Accepted'?'green':'blue'}`}>{a.status}</span></td></tr>)}</tbody></table></div>
    </section>
  </>;
}
