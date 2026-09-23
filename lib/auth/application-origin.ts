export function safeApplicationOrigin() {
  const candidates = [
    process.env.EMAIL_APP_BASE_URL,
    process.env.NODE_ENV !== 'production' ? 'http://localhost:3000' : '',
  ];

  for (const candidate of candidates) {
    try {
      const url = new URL(candidate ?? '');
      const local = process.env.NODE_ENV !== 'production'
        && ['localhost', '127.0.0.1'].includes(url.hostname);
      if (
        (url.protocol === 'https:' || (local && url.protocol === 'http:'))
        && !url.username
        && !url.password
      ) {
        return url.origin;
      }
    } catch {
      // Try the next trusted deployment setting.
    }
  }

  return null;
}

export function applicationUrl(pathname: string) {
  const origin = safeApplicationOrigin();
  return origin ? new URL(pathname, origin).toString() : undefined;
}
