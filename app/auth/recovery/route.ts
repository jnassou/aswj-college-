import { NextRequest, NextResponse } from 'next/server';
import { applicationUrl } from '../../../lib/auth/application-origin';
import { applyAuthResponseHeaders, authRedirect } from '../../../lib/auth/response';
import { createSupabaseServerClient } from '../../../lib/supabase/server';

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const resetUrl = applicationUrl('/reset-password');
  const expiredUrl = applicationUrl('/forgot-password?error=expired');

  if (!resetUrl || !expiredUrl) {
    return NextResponse.json(
      { error: 'Password recovery is not configured.' },
      {
        status: 503,
        headers: {
          'Cache-Control': 'private, no-cache, no-store, must-revalidate, max-age=0',
        },
      }
    );
  }

  if (code) {
    const response = authRedirect(resetUrl);
    const supabase = await createSupabaseServerClient((headers) => {
      applyAuthResponseHeaders(response, headers);
    });
    let failed = true;
    try {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      failed = Boolean(error);
    } catch {
      failed = true;
    }
    if (!failed) {
      return response;
    }
  }

  return authRedirect(expiredUrl);
}
