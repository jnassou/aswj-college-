import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '../../../lib/supabase/server';

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL('/student', request.url));
    }
  }

  const errorUrl = new URL('/login', request.url);
  errorUrl.searchParams.set('error', 'confirmation_failed');
  return NextResponse.redirect(errorUrl);
}
