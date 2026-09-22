import type { EmailOtpType } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '../../../lib/supabase/server';

const ALLOWED_TYPES = new Set<EmailOtpType>([
  'email',
  'signup',
]);

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get('token_hash');
  const candidateType = request.nextUrl.searchParams.get('type') as EmailOtpType | null;

  if (tokenHash && candidateType && ALLOWED_TYPES.has(candidateType)) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: candidateType,
    });
    if (!error) {
      return NextResponse.redirect(new URL('/student', request.url));
    }
  }

  const errorUrl = new URL('/login', request.url);
  errorUrl.searchParams.set('error', 'confirmation_failed');
  return NextResponse.redirect(errorUrl);
}
