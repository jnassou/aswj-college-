import Image from 'next/image';
import { redirect } from 'next/navigation';
import { requireAdmin } from '../../lib/supabase/server';
import { logout } from '../login/actions';
import AdminNav from './AdminNav';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  try {
    await requireAdmin();
  } catch {
    redirect('/login?error=forbidden');
  }

  return (
    <div className="shell admin-shell">
      <aside className="sidebar admin-sidebar">
        <a className="admin-brand" href="/admin" aria-label="ASWJ College administration home">
          <Image className="brand-logo" src="/aswj-logo.png" alt="" width={420} height={260} priority />
          <span>
            <strong>ASWJ College</strong>
            <small>Administration</small>
          </span>
        </a>
        <AdminNav />
        <form className="admin-sidebar-footer" action={logout}>
          <button className="btn btn-sidebar" type="submit">Sign out</button>
        </form>
      </aside>
      <main className="main admin-main" id="main-content" tabIndex={-1}>{children}</main>
    </div>
  );
}
