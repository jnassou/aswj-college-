import Image from 'next/image';
import { redirect } from 'next/navigation';
import { requireAdmin } from '../../lib/supabase/server';
import { logout } from '../login/actions';

const links = [
  ['/admin', 'Dashboard'],
  ['/admin/applications', 'Applications'],
  ['/admin/forms-imports', 'Registration Setup'],
  ['/admin/attendance-review', 'Attendance Review'],
  ['/admin/students', 'Students'],
  ['/admin/classes', 'Classes'],
  ['/admin/check-in', 'QR Check-in'],
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  try {
    await requireAdmin();
  } catch {
    redirect('/login?error=forbidden');
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <Image className="brand-logo" src="/aswj-logo.png" alt="ASWJ Islamic College" width={420} height={260} priority />
        <div className="brand-sub">College Admin</div>
        <nav className="nav">{links.map(([href,label]) => <a key={href} href={href}>{label}</a>)}</nav>
        <form action={logout} style={{ marginTop: 28 }}><button className="btn" type="submit">Sign out</button></form>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
