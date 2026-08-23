'use client';

import { usePathname } from 'next/navigation';

const links = [
  ['/admin', 'Overview'],
  ['/admin/applications', 'Applications'],
  ['/admin/classes', 'Classes'],
  ['/admin/students', 'Students'],
  ['/admin/attendance-review', 'Attendance'],
  ['/admin/check-in', 'QR check-in'],
  ['/admin/email-delivery', 'Email delivery'],
  ['/admin/forms-imports', 'Legacy forms'],
] as const;

function isCurrent(pathname: string, href: string) {
  return href === '/admin' ? pathname === href : pathname.startsWith(href);
}

export default function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="admin-nav" aria-label="Administration">
      {links.map(([href, label]) => {
        const current = isCurrent(pathname, href);
        return (
          <a key={href} href={href} aria-current={current ? 'page' : undefined}>
            <span className="admin-nav-indicator" aria-hidden="true" />
            <span>{label}</span>
          </a>
        );
      })}
    </nav>
  );
}
