create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id,role,first_name,last_name,email,mobile)
  values (
    new.id,
    'student'::public.user_role,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'first_name'), ''), 'Student'),
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'last_name'), ''), ''),
    new.email,
    nullif(trim(coalesce(new.phone, new.raw_user_meta_data ->> 'mobile', '')), '')
  )
  on conflict (id) do update set
    email=excluded.email,
    mobile=coalesce(excluded.mobile, public.profiles.mobile),
    updated_at=now();
  return new;
end; $$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.sync_auth_user_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set
    email=new.email,
    mobile=coalesce(nullif(trim(coalesce(new.phone, new.raw_user_meta_data ->> 'mobile', '')), ''), mobile),
    first_name=coalesce(nullif(trim(new.raw_user_meta_data ->> 'first_name'), ''), first_name),
    last_name=coalesce(nullif(trim(new.raw_user_meta_data ->> 'last_name'), ''), last_name),
    updated_at=now()
  where id=new.id;
  return new;
end; $$;
revoke execute on function public.sync_auth_user_profile() from public, anon, authenticated;
drop trigger if exists on_auth_user_updated on auth.users;
create trigger on_auth_user_updated after update of email,phone,raw_user_meta_data on auth.users
for each row execute function public.sync_auth_user_profile();
