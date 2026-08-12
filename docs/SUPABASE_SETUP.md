# ASWJ College — Supabase live setup

1. Copy `.env.example` to `.env.local` and fill in the project URL and publishable key.
2. Keep `SUPABASE_SERVICE_ROLE_KEY` server-only. Never expose it in browser code or a `NEXT_PUBLIC_*` variable.
3. Apply every SQL file in `supabase/migrations` in filename order. Do not skip the later notification, attendance and security migrations.
4. Create the first administrator in Supabase Auth.
5. Set that Auth user's `app_metadata.role` to `super_admin`. Do not use `user_metadata` for roles.
6. Insert/update the matching `profiles` row using the same Auth user UUID.
7. Start the app and sign in at `/login`.

Example profile row after the Auth user exists:

```sql
insert into public.profiles (id, role, first_name, last_name, email)
values ('AUTH_USER_UUID', 'super_admin', 'Admin', 'User', 'admin@example.com')
on conflict (id) do update set
  first_name = excluded.first_name,
  last_name = excluded.last_name,
  email = excluded.email,
  role = 'super_admin';
```

Set `app_metadata.role` through the Supabase Dashboard user-management interface or a trusted server/admin API. The application never permits a student to self-promote to admin.
