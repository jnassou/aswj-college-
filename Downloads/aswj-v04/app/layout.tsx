import './globals.css';

export const metadata = {
  title: 'ASWJ College',
  description: 'ASWJ College Admin and Student Portal',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
