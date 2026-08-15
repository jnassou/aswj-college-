import type { CSSProperties, ReactNode } from 'react';

export type TransactionalEmailProps = {
  preview: string;
  heading: string;
  children: ReactNode;
  portalUrl: string;
};

const bodyStyle: CSSProperties = {
  margin: 0,
  padding: '28px 12px',
  backgroundColor: '#f3f7f5',
  color: '#17342b',
  fontFamily: 'Arial, Helvetica, sans-serif',
};

const containerStyle: CSSProperties = {
  width: '100%',
  maxWidth: '600px',
  margin: '0 auto',
  border: '1px solid #dce7e2',
  borderRadius: '14px',
  overflow: 'hidden',
  backgroundColor: '#ffffff',
};

export default function TransactionalEmail({
  preview,
  heading,
  children,
  portalUrl,
}: TransactionalEmailProps) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{heading}</title>
      </head>
      <body style={bodyStyle}>
        <div
          aria-hidden="true"
          style={{
            display: 'none',
            maxHeight: 0,
            overflow: 'hidden',
            opacity: 0,
          }}
        >
          {preview}
        </div>
        <table role="presentation" cellPadding="0" cellSpacing="0" style={containerStyle}>
          <tbody>
            <tr>
              <td
                style={{
                  padding: '22px 26px',
                  backgroundColor: '#087f70',
                  color: '#ffffff',
                }}
              >
                <div style={{ fontSize: '13px', fontWeight: 700, letterSpacing: '0.08em' }}>
                  ASWJ COLLEGE
                </div>
                <h1 style={{ margin: '8px 0 0', fontSize: '25px', lineHeight: 1.25 }}>
                  {heading}
                </h1>
              </td>
            </tr>
            <tr>
              <td style={{ padding: '26px', fontSize: '16px', lineHeight: 1.6 }}>
                {children}
                <p style={{ margin: '26px 0 8px' }}>
                  <a
                    href={portalUrl}
                    style={{
                      display: 'inline-block',
                      padding: '12px 18px',
                      borderRadius: '8px',
                      backgroundColor: '#087f70',
                      color: '#ffffff',
                      fontWeight: 700,
                      textDecoration: 'none',
                    }}
                  >
                    Open Student Portal
                  </a>
                </p>
                <p style={{ margin: '24px 0 0', color: '#5f716b', fontSize: '13px' }}>
                  This is an operational message about your ASWJ College record. If you
                  need help, reply to this email to contact administration.
                </p>
              </td>
            </tr>
          </tbody>
        </table>
      </body>
    </html>
  );
}
