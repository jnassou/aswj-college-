'use server';

import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '../../lib/supabase/server';

function roleDestination(role: string) {
  return ['admin', 'super_admin'].includes(role) ? '/admin' : '/student';
}

export async function login(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');
  if (!email || !password) redirect('/login?error=missing');

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) redirect('/login?error=invalid');

  const { data: { user } } = await supabase.auth.getUser();
  const role = String(user?.app_metadata?.role ?? 'student');
  redirect(roleDestination(role));
}

export async function signup(formData: FormData) {
  const firstName = String(formData.get('first_name') ?? '').trim();
  const lastName = String(formData.get('last_name') ?? '').trim();
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');

  if (!firstName || !lastName || !email || password.length < 8) {
    redirect('/login?mode=signup&error=signup_fields');
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

  if (error) redirect('/login?mode=signup&error=signup_failed');

  // Hosted Supabase normally requires email confirmation. If a session exists,
  // the user can enter the Student Portal immediately; otherwise show confirmation state.
  if (data.session) redirect('/student');
  redirect('/login?created=1');
}

export async function logout() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect('/login');
}
