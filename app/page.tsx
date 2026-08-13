import { redirect } from 'next/navigation';
import { createSupabaseServerClient, hasSupabaseConfig } from '../lib/supabase/server';

export default async function HomePage() {
  if (!hasSupabaseConfig()) redirect('/apply');
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/apply');
  const role = String(user.app_metadata?.role ?? 'student');
  redirect(['admin', 'super_admin'].includes(role) ? '/admin' : '/student');
}
