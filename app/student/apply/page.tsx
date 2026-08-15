import Image from 'next/image';
import { redirect } from 'next/navigation';
import { REGISTRATION_PRIVACY_NOTICE_VERSION } from '../../../lib/registration-courses';
import { createSupabaseServerClient } from '../../../lib/supabase/server';
import RegistrationForm from './RegistrationForm';
import type { RegistrationOption } from './types';

type RegistrationOptionRow = {
  class_id: string;
  class_name: string;
  term: string | null;
  location: string | null;
  day_of_week: number | null;
  start_time: string | null;
  end_time: string | null;
  available: boolean;
  availability_reason: string | null;
};

export const metadata = {
  title: 'Class application | ASWJ College',
};

export default async function StudentApplyPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) redirect('/login?next=%2Fstudent%2Fapply');
  if (!user.email || !user.email_confirmed_at) {
    redirect('/login?error=confirm_required&next=%2Fstudent%2Fapply');
  }

  const authRole = String(user.app_metadata?.role ?? 'student');
  if (['admin', 'super_admin'].includes(authRole)) redirect('/admin');
  if (authRole !== 'student') redirect('/student');

  const [profileResult, optionsResult] = await Promise.all([
    supabase
      .from('profiles')
      .select('first_name,last_name,mobile,date_of_birth,role')
      .eq('id', user.id)
      .maybeSingle(),
    supabase.rpc('student_registration_class_options'),
  ]);

  if (profileResult.error || !profileResult.data) {
    throw new Error('Your Student Portal profile could not be loaded.');
  }
  if (profileResult.data.role !== 'student') redirect('/student');
  if (optionsResult.error) {
    throw new Error('Registration options could not be loaded.');
  }

  const rows = (optionsResult.data ?? []) as RegistrationOptionRow[];
  const options: RegistrationOption[] = rows.map((row) => ({
    classId: String(row.class_id),
    className: String(row.class_name),
    term: row.term ? String(row.term) : null,
    location: row.location ? String(row.location) : null,
    dayOfWeek: row.day_of_week === null || row.day_of_week === undefined
      ? null
      : Number(row.day_of_week),
    startTime: row.start_time ? String(row.start_time) : null,
    endTime: row.end_time ? String(row.end_time) : null,
    available: Boolean(row.available),
    availabilityReason: row.availability_reason
      ? String(row.availability_reason)
      : null,
  }));

  return (
    <main className="student-portal">
      <header className="student-header">
        <div className="student-brand-row">
          <Image
            className="student-logo"
            src="/aswj-logo.png"
            alt="ASWJ Islamic College"
            width={360}
            height={225}
            priority
          />
          <div>
            <div className="student-eyebrow">ASWJ College Student Portal</div>
            <h1>Class application</h1>
            <p>{user.email}</p>
          </div>
        </div>
        <a className="btn student-signout" href="/student">Back to portal</a>
      </header>

      <section className="portal-section">
        <div className="portal-section-head">
          <div>
            <span className="small">Registration workflow</span>
            <h2>Apply for an available class</h2>
          </div>
        </div>
        <p className="subtitle" style={{ marginBottom: 16, lineHeight: 1.55 }}>
          Complete this form for the class you want to apply for. Your application will be submitted as pending for
          administration to review, and its status will appear in your Student Portal.
        </p>

        <RegistrationForm
          email={user.email}
          privacyNoticeVersion={REGISTRATION_PRIVACY_NOTICE_VERSION}
          options={options}
          initialValues={{
            firstName: String(profileResult.data.first_name ?? ''),
            lastName: String(profileResult.data.last_name ?? ''),
            dateOfBirth: profileResult.data.date_of_birth
              ? String(profileResult.data.date_of_birth)
              : '',
            phoneNumber: profileResult.data.mobile ? String(profileResult.data.mobile) : '',
          }}
        />
      </section>
    </main>
  );
}
