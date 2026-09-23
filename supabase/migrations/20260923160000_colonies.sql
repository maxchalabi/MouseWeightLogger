-- Shared colonies. The service role (Edge Functions) creates devices, colonies,
-- invites, and memberships. Signed-in devices read and, when they are owners, write.

create table public.devices (
  id uuid primary key,
  auth_user_id uuid not null unique references auth.users (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table public.colonies (
  id uuid primary key,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.colony_members (
  colony_id uuid not null references public.colonies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'watcher')),
  device_name text not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (colony_id, user_id)
);

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  colony_id uuid not null references public.colonies (id) on delete cascade,
  role text not null check (role in ('owner', 'watcher')),
  code_hash text not null,
  created_by uuid not null references auth.users (id),
  expires_at timestamptz not null,
  redeemed_by uuid references auth.users (id),
  redeemed_at timestamptz
);

create index invites_code_hash_idx on public.invites (code_hash);

create table public.mice (
  id uuid primary key,
  colony_id uuid not null references public.colonies (id) on delete cascade,
  name text not null,
  sex text not null check (sex in ('M', 'F', 'U')),
  birthdate text,
  strain text,
  genotype text,
  cage text,
  ear_mark text,
  experiment text,
  notes text,
  photo_path text,
  color text,
  baseline_weight_g double precision,
  restriction_start text,
  status text not null check (status in ('active', 'inactive')),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz
);

create unique index mice_colony_name_live
  on public.mice (colony_id, name)
  where deleted_at is null;

create index mice_colony_updated_idx on public.mice (colony_id, updated_at);

create table public.weights (
  id uuid primary key,
  mouse_id uuid not null references public.mice (id) on delete cascade,
  date text not null,
  weight_g double precision not null,
  note text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz
);

create unique index weights_mouse_date_live
  on public.weights (mouse_id, date)
  where deleted_at is null;

create index weights_mouse_updated_idx on public.weights (mouse_id, updated_at);

create table public.settings (
  colony_id uuid not null references public.colonies (id) on delete cascade,
  key text not null,
  value text not null,
  updated_at timestamptz not null,
  primary key (colony_id, key)
);

alter table public.devices enable row level security;
alter table public.colonies enable row level security;
alter table public.colony_members enable row level security;
alter table public.invites enable row level security;
alter table public.mice enable row level security;
alter table public.weights enable row level security;
alter table public.settings enable row level security;

create or replace function public.is_member(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.colony_members
    where colony_id = cid
      and user_id = auth.uid()
      and revoked_at is null
  );
$$;

create or replace function public.is_owner(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.colony_members
    where colony_id = cid
      and user_id = auth.uid()
      and role = 'owner'
      and revoked_at is null
  );
$$;

revoke all on function public.is_member(uuid) from public, anon;
revoke all on function public.is_owner(uuid) from public, anon;
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.is_owner(uuid) to authenticated;

grant select on public.colonies, public.colony_members to authenticated;
grant select, insert, update, delete on public.mice, public.weights, public.settings to authenticated;
grant update on public.colonies to authenticated;

create policy colonies_select on public.colonies
  for select to authenticated
  using (public.is_member(id));

create policy colonies_update on public.colonies
  for update to authenticated
  using (public.is_owner(id))
  with check (public.is_owner(id));

create policy members_select on public.colony_members
  for select to authenticated
  using (public.is_member(colony_id));

create policy mice_select on public.mice
  for select to authenticated
  using (public.is_member(colony_id));

create policy mice_insert on public.mice
  for insert to authenticated
  with check (public.is_owner(colony_id));

create policy mice_update on public.mice
  for update to authenticated
  using (public.is_owner(colony_id))
  with check (public.is_owner(colony_id));

create policy mice_delete on public.mice
  for delete to authenticated
  using (public.is_owner(colony_id));

create policy weights_select on public.weights
  for select to authenticated
  using (
    exists (
      select 1 from public.mice
      where mice.id = weights.mouse_id
        and public.is_member(mice.colony_id)
    )
  );

create policy weights_insert on public.weights
  for insert to authenticated
  with check (
    exists (
      select 1 from public.mice
      where mice.id = weights.mouse_id
        and public.is_owner(mice.colony_id)
    )
  );

create policy weights_update on public.weights
  for update to authenticated
  using (
    exists (
      select 1 from public.mice
      where mice.id = weights.mouse_id
        and public.is_owner(mice.colony_id)
    )
  )
  with check (
    exists (
      select 1 from public.mice
      where mice.id = weights.mouse_id
        and public.is_owner(mice.colony_id)
    )
  );

create policy weights_delete on public.weights
  for delete to authenticated
  using (
    exists (
      select 1 from public.mice
      where mice.id = weights.mouse_id
        and public.is_owner(mice.colony_id)
    )
  );

create policy settings_select on public.settings
  for select to authenticated
  using (public.is_member(colony_id));

create policy settings_insert on public.settings
  for insert to authenticated
  with check (public.is_owner(colony_id));

create policy settings_update on public.settings
  for update to authenticated
  using (public.is_owner(colony_id))
  with check (public.is_owner(colony_id));

create policy settings_delete on public.settings
  for delete to authenticated
  using (public.is_owner(colony_id));

alter table public.mice replica identity full;
alter table public.weights replica identity full;
alter table public.settings replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.mice;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.weights;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.settings;
exception
  when duplicate_object then null;
end $$;

insert into storage.buckets (id, name, public)
values ('photos', 'photos', false)
on conflict (id) do nothing;

create policy photos_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'photos'
    and public.is_member(((storage.foldername(name))[1])::uuid)
  );

create policy photos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'photos'
    and public.is_owner(((storage.foldername(name))[1])::uuid)
  );

create policy photos_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'photos'
    and public.is_owner(((storage.foldername(name))[1])::uuid)
  )
  with check (
    bucket_id = 'photos'
    and public.is_owner(((storage.foldername(name))[1])::uuid)
  );

create policy photos_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'photos'
    and public.is_owner(((storage.foldername(name))[1])::uuid)
  );
