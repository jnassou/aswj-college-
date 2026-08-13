'use server';

import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '../../lib/supabase/server';

const APPLY_PATH = '/student/apply';

function safeNext(value: FormDataEntryValue | null) {
  return typeof value === 'string' && value === APPLY_PATH ? APPLY_PATH : null;
}

function loginRedirect(error: string, nextPath: string | null, signupMode = false): never {
  const params = new URLSearchParams({ error });
  if (signupMode) params.set('mode', 'signup');
  if (nextPath) params.set('next', nextPath);
  redirect(`/login?${params.toString()}`);
}

function roleDestination(role: string, nextPath: string | null) {
  if (['admin', 'super_admin'].includes(role)) return '/admin';
  if (role === 'student' && nextPath) return nextPath;
  return '/student';
}

export async function login(formData: FormData) {
  const nextPath = safeNext(formData.get('next'));
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');
  if (!email || email.length > 320 || !password || password.length > 256) {
    loginRedirect('missing', nextPath);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) loginRedirect('invalid', nextPath);

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) loginRedirect('invalid', nextPath);

  const role = String(user.app_metadata?.role ?? 'student');
  redirect(roleDestination(role, nextPath));
}

export async function signup(formData: FormData) {
  const nextPath = safeNext(formData.get('next'));
  const firstName = String(formData.get('first_name') ?? '').trim();
  const lastName = String(formData.get('last_name') ?? '').trim();
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');

  if (
    !firstName || firstName.length > 100
    || !lastName || lastName.length > 100
    || !email || email.length > 320
    || password.length < 8 || password.length > 256
  ) {
    loginRedirect('signup_fields', nextPath, true);
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        first_name: firstName,
        last_name: lastName,
      },
    },
  });

  if (error) loginRedirect('signup_failed', nextPath, true);

  // Hosted Supabase normally requires email confirmation. If a session exists,
  // the user can enter the Student Portal immediately; otherwise show confirmation state.
  if (data.session) redirect(roleDestination('student', nextPath));

  const params = new URLSearchParams({ created: '1' });
  if (nextPath) params.set('next', nextPath);
  redirect(`/login?${params.toString()}`);
}

export async function logout() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect('/login');
}
