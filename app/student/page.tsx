import Image from 'next/image';
import QRCode from 'qrcode';
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

  let { data: qr } = await supabase
    .from('student_qr_tokens')
    .select('token')
    .eq('student_id', user.id)
    .eq('active', true)
    .maybeSingle();

  if (!qr) {
    const created = await supabase
      .from('student_qr_tokens')
      .insert({ student_id: user.id, active: true })
      .select('token')
      .single();
    qr = created.data;
  }

  const qrValue = qr?.token ? `aswj:${qr.token}` : null;
  const qrImage = qrValue ? await QRCode.toDataURL(qrValue, {
    width: 320,
    margin: 2,
    errorCorrectionLevel: 'M',
  }) : null;

  const total = attendance.filter((a:any) => a.status !== 'cancelled').length;
  const attended = attendance.filter((a:any) => ['present','late'].includes(a.status)).length;
  const attendanceRate = total ? Math.round((attended / total) * 100) : null;

  const name = `${profile?.first_name ?? ''} ${profile?.last_name ?? ''}`.trim() || 'Student';

  return <main className="student-portal">
    <div className="student-header">
      <div className="student-brand-row">
        <Image className="student-logo" src="/aswj-logo.png" alt="ASWJ Islamic College" width={360} height={225} priority />
        <div>
          <div className="small" style={{color:'#fff',opacity:.9}}>ASWJ College Student Portal</div>
          <h1 style={{margin:'6px 0'}}>Assalamu alaikum, {name}</h1>
          <p style={{margin:0,opacity:.85}}>{user.email}</p>
        </div>
      </div>
      <form action={logout}><button className="btn" type="submit">Sign out</button></form>
    </div>

    <div className="portal-grid">
      <section className="card">
        <div className="small">Current classes</div>
        {(enrolments ?? []).length ? (enrolments ?? []).map((e:any) => <div key={e.id} style={{marginTop:12}}>
          <h3 style={{marginBottom:6}}>{e.classes?.name ?? 'Class'}{e.classes?.term ? ` — ${e.classes.term}` : ''}</h3>
          <span className={`badge ${e.status === 'enrolled' ? 'green' : e.status === 'suspended' ? 'red' : 'grey'}`}>{e.status}</span>
          {e.classes?.location && <p className="small">{e.classes.location}</p>}
        </div>) : <p className="subtitle">No current enrolments yet.</p>}
      </section>

      <section className="card">
        <div className="small">Attendance</div>
        <div className="metric-value">{attendanceRate === null ? '—' : `${attendanceRate}%`}</div>
        <p className="small">{attended} attended · {Math.max(0,total-attended)} missed/excused</p>
      </section>
    </div>

    <section className="card" style={{marginTop:14,textAlign:'center'}}>
      <h3>Your student check-in QR</h3>
      <p className="small">Present this code to the class administrator when checking in. It contains a private random token, not your personal details.</p>
      {qrImage ? (
        <img src={qrImage} alt="Student check-in QR code" style={{display:'block',width:280,maxWidth:'85%',height:'auto',margin:'18px auto',borderRadius:12}} />
      ) : (
        <div className="notice">Your QR code could not be issued yet. Contact administration.</div>
      )}
    </section>
  </main>;
}
