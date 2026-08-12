import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '../../lib/supabase/server';
import { logout } from '../login/actions';

export default async function StudentPortal() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('first_name,last_name')
    .eq('id', user.id)
    .maybeSingle();

  const { data: enrolments } = await supabase
    .from('enrolments')
    .select('id,status,classes!enrolments_class_id_fkey(name,term,location)')
    .eq('student_id', user.id)
    .order('enrolled_at', { ascending: false });

  const enrolmentIds = (enrolments ?? []).map((e:any) => e.id);
  let attendance: any[] = [];
  if (enrolmentIds.length) {
    const result = await supabase
      .from('attendance')
      .select('enrolment_id,status,class_sessions!attendance_session_id_fkey(session_date)')
      .in('enrolment_id', enrolmentIds);
    attendance = result.data ?? [];
  }

  const { data: qr } = await supabase
    .from('student_qr_tokens')
    .select('token')
    .eq('student_id', user.id)
    .eq('active', true)
    .maybeSingle();

  const total = attendance.filter((a:any) => a.status !== 'cancelled').length;
  const attended = attendance.filter((a:any) => ['present','late'].includes(a.status)).length;
  const attendanceRate = total ? Math.round((attended / total) * 100) : null;

  const name = `${profile?.first_name ?? ''} ${profile?.last_name ?? ''}`.trim() || 'Student';

  return <main className="student-portal">
    <div className="student-header">
      <div className="small" style={{color:'#dce9e1'}}>ASWJ College Student Portal</div>
      <h1 style={{margin:'6px 0'}}>Assalamu alaikum, {name}</h1>
      <p style={{margin:0,opacity:.8}}>{user.email}</p>
      <form action={logout} style={{marginTop:16}}><button className="btn" type="submit">Sign out</button></form>
    </div>

    <div className="portal-grid">
      <section className="card">
        <div className="small">Current classes</div>
        {(enrolments ?? []).length ? (enrolments ?? []).map((e:any) => <div key={e.id} style={{marginTop:12}}>
          <h3 style={{marginBottom:6}}>{e.classes?.name ?? 'Class'}{e.classes?.term ? ` — ${e.classes.term}` : ''}</h3>
          <span className={`badge ${e.status === 'enrolled' ? 'green' : e.status === 'suspended' ? 'red' : ''}`}>{e.status}</span>
          {e.classes?.location && <p className="small">{e.classes.location}</p>}
        </div>) : <p className="subtitle">No current enrolments yet.</p>}
      </section>

      <section className="card">
        <div className="small">Attendance</div>
        <div className="metric-value">{attendanceRate === null ? '—' : `${attendanceRate}%`}</div>
        <p className="small">{attended} attended · {total-attended} missed/excused</p>
      </section>
    </div>

    <section className="card" style={{marginTop:14,textAlign:'center'}}>
      <h3>Your student QR identity</h3>
      <p className="small">The QR image will encode this private random token, not your name or personal details.</p>
      <div className="qr-placeholder" />
      <code style={{display:'block',overflowWrap:'anywhere',fontSize:12}}>{qr?.token ?? 'QR identity is being issued'}</code>
    </section>
  </main>;
}
