import { NextResponse } from 'next/server';

const AUTH_NO_STORE_HEADERS: Record<string, string> = {
  'Cache-Control': 'private, no-cache, no-store, must-revalidate, max-age=0',
  Expires: '0',
  Pragma: 'no-cache',
};

export function applyAuthResponseHeaders(
  response: NextResponse,
  headers: Record<string, string> = AUTH_NO_STORE_HEADERS
) {
  Object.entries(headers).forEach(([name, value]) => response.headers.set(name, value));
}

export function authRedirect(destination: string) {
  const response = NextResponse.redirect(destination);
  applyAuthResponseHeaders(response);
  return response;
}
