import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export function hasSupabaseConfig() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  );
}

export async function createSupabaseServerClient() {
  if (!hasSupabaseConfig()) {
    throw new Error('Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.');
  }

  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Cookie writes may be unavailable while rendering Server Components.
            // Session refresh should be handled by proxy/middleware when auth is enabled.
          }
        },
      },
    }
  );
}

export async function requireAdmin() {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) throw new Error('Authentication required.');

  const role = String(user.app_metadata?.role ?? '');
  if (!['admin', 'super_admin'].includes(role)) {
    throw new Error('Administrator access required.');
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, first_name, last_name')
    .eq('id', user.id)
    .maybeSingle();

  return { supabase, user, profile, role };
}
