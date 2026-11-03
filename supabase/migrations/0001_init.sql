-- =============================================================================
-- Pahil Vatika Yoga Group, Khajuraho — database schema
-- Run once in Supabase → SQL Editor (or `supabase db push`).
-- All authorization is enforced here (RLS + triggers). The frontend is a static
-- site holding only the public anon key, so nothing in the browser is trusted.
-- =============================================================================

-- gen_random_uuid() is built into Postgres 13+, no extension needed.

-- -----------------------------------------------------------------------------
-- Roles & profiles
-- -----------------------------------------------------------------------------
create type app_role as enum ('super_admin', 'admin', 'treasurer', 'member');

create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  display_name text,
  role        app_role not null default 'member',
  approved    boolean not null default false,
  member_id   uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Helper functions. SECURITY DEFINER so they can read profiles without recursing
-- through profiles' own RLS policies.
create or replace function public.current_app_role() returns app_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid() and approved
$$;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from profiles where id = auth.uid() and approved)
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_app_role() in ('super_admin','admin'), false)
$$;

create or replace function public.is_super_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_app_role() = 'super_admin', false)
$$;

create or replace function public.is_treasurer() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_app_role() in ('super_admin','treasurer'), false)
$$;

-- -----------------------------------------------------------------------------
-- Site settings (key → jsonb). Readable by everyone, so never store secrets here.
-- -----------------------------------------------------------------------------
create table public.site_settings (
  key        text primary key,
  value      jsonb not null,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

create or replace function public.setting(k text) returns jsonb
language sql stable security definer set search_path = public as $$
  select value from site_settings where key = k
$$;

create or replace function public.finance_visible() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_treasurer()
      or (public.is_member() and coalesce((public.setting('permissions')->>'finance_visible_to_members')::boolean, true))
$$;

-- -----------------------------------------------------------------------------
-- Members (the community directory — independent of login accounts)
-- -----------------------------------------------------------------------------
create table public.members (
  id               uuid primary key default gen_random_uuid(),
  member_no        serial unique,
  full_name        text not null check (length(trim(full_name)) between 2 and 120),
  photo_path       text,
  birth_day        smallint check (birth_day between 1 and 31),
  birth_month      smallint check (birth_month between 1 and 12),
  birth_year       smallint check (birth_year between 1900 and 2100),
  married          boolean,
  anniv_day        smallint check (anniv_day between 1 and 31),
  anniv_month      smallint check (anniv_month between 1 and 12),
  anniv_year       smallint check (anniv_year between 1900 and 2100),
  profession       text,
  joining_date     date,
  bio              text,
  phone            text,
  email            text,
  address          text,
  show_birthday    boolean not null default true,   -- day+month visible to members
  show_anniversary boolean not null default true,
  show_phone       boolean not null default false,  -- phone visible to members
  is_public        boolean not null default false,  -- name/photo visible to visitors
  status           text not null default 'active' check (status in ('active','inactive')),
  user_id          uuid unique references auth.users(id) on delete set null,
  notes            text,                            -- admin-only data-quality notes
  import_batch_id  uuid,
  created_by       uuid references auth.users(id) default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check ((birth_day is null) = (birth_month is null)),
  check ((anniv_day is null) = (anniv_month is null))
);
create index members_name_idx on public.members (lower(full_name));
create index members_birth_idx on public.members (birth_month, birth_day);
create index members_anniv_idx on public.members (anniv_month, anniv_day);
create unique index members_email_uniq on public.members (lower(email)) where email is not null;

alter table public.profiles
  add constraint profiles_member_fk foreign key (member_id) references public.members(id) on delete set null;

-- Privacy-filtered directory. Owner-rights view: it reads members directly and
-- masks every private column according to the viewer and the member's settings.
create or replace view public.member_directory with (security_barrier = true) as
select
  m.id, m.member_no, m.full_name, m.photo_path, m.profession, m.status,
  case when public.is_member() then m.joining_date end as joining_date,
  case when public.is_member() then m.bio end as bio,
  case when public.is_admin() or (public.is_member() and m.show_birthday) or m.user_id = auth.uid() then m.birth_day end as birth_day,
  case when public.is_admin() or (public.is_member() and m.show_birthday) or m.user_id = auth.uid() then m.birth_month end as birth_month,
  case when public.is_admin() or m.user_id = auth.uid() then m.birth_year end as birth_year,
  case when public.is_admin() or (public.is_member() and m.show_anniversary) or m.user_id = auth.uid() then m.anniv_day end as anniv_day,
  case when public.is_admin() or (public.is_member() and m.show_anniversary) or m.user_id = auth.uid() then m.anniv_month end as anniv_month,
  case when public.is_admin() or (public.is_member() and m.show_anniversary) or m.user_id = auth.uid() then m.anniv_year end as anniv_year,
  case when public.is_admin() or (public.is_member() and m.show_phone) or m.user_id = auth.uid() then m.phone end as phone,
  case when public.is_admin() or m.user_id = auth.uid() then m.email end as email,
  m.is_public, m.user_id
from public.members m
where (m.status = 'active' or public.is_admin())
  and (public.is_member() or m.is_public);

-- Link a profile to a member when the emails match (on sign-up or when the
-- admin later adds the email to the member). Matching email ⇒ auto-approved.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_member uuid;
  v_first  boolean;
begin
  select id into v_member from members where lower(email) = lower(new.email) and user_id is null limit 1;
  -- The very first account becomes super admin (bootstraps a fresh install).
  select not exists(select 1 from profiles where role = 'super_admin') into v_first;
  insert into profiles (id, email, display_name, role, approved, member_id)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
          case when v_first then 'super_admin'::app_role else 'member'::app_role end,
          v_first or v_member is not null, v_member);
  if v_member is not null then
    update members set user_id = new.id where id = v_member;
  end if;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Users may change only their own display name; role/approval changes go
-- through admin policies and are re-checked here so a member cannot self-promote.
create or replace function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if (new.role is distinct from old.role) then
    if not public.is_super_admin() then raise exception 'Only a super admin can change roles'; end if;
    if old.role = 'super_admin' and new.role <> 'super_admin'
       and (select count(*) from profiles where role = 'super_admin' and approved) <= 1 then
      raise exception 'Cannot remove the last super admin';
    end if;
  end if;
  if (new.approved is distinct from old.approved or new.member_id is distinct from old.member_id)
     and not public.is_admin() then
    raise exception 'Only admins can approve or link accounts';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.guard_profile_update();

-- Members may edit their own profile fields, but never status/role-like columns.
create or replace function public.guard_member_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;  -- internal trigger (e.g. sign-up linking)
  if not public.is_admin() then
    if new.user_id is distinct from old.user_id or new.status is distinct from old.status
       or new.is_public is distinct from old.is_public or new.notes is distinct from old.notes
       or new.member_no is distinct from old.member_no then
      raise exception 'Not allowed to change these fields';
    end if;
    if not coalesce((public.setting('permissions')->>'members_edit_own_profile')::boolean, true) then
      raise exception 'Profile editing is disabled by the administrator';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger members_guard before update on public.members
  for each row execute function public.guard_member_update();

-- -----------------------------------------------------------------------------
-- Albums, photos & videos
-- -----------------------------------------------------------------------------
create table public.albums (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text,
  cover_photo_id uuid,
  is_public   boolean not null default false,
  sort_order  int not null default 0,
  created_by  uuid references auth.users(id) default auth.uid(),
  created_at  timestamptz not null default now()
);

create table public.photos (
  id            uuid primary key default gen_random_uuid(),
  album_id      uuid references public.albums(id) on delete set null,
  event_id      uuid,
  media_type    text not null default 'image' check (media_type in ('image','video','youtube')),
  storage_path  text,             -- display version (compressed image / video file)
  thumb_path    text,             -- small thumbnail
  original_path text,             -- untouched original (optional, see settings)
  video_url     text,             -- YouTube link for media_type = 'youtube'
  caption       text check (length(caption) <= 1000),
  taken_on      date,
  width         int,
  height        int,
  size_bytes    bigint not null default 0,
  file_hash     text,             -- SHA-256 of the original file → duplicate detection
  file_name     text,
  mime_type     text,
  status        text not null default 'approved' check (status in ('pending','approved','hidden')),
  is_public     boolean not null,   -- set by trigger (inherits album) when not given
  uploaded_by   uuid references auth.users(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz,      -- soft delete; files purged by admin "empty trash"
  deleted_by    uuid references auth.users(id)
);
create index photos_album_idx on public.photos (album_id, created_at desc) where deleted_at is null;
create index photos_created_idx on public.photos (created_at desc) where deleted_at is null;
create index photos_event_idx on public.photos (event_id) where deleted_at is null;
create unique index photos_hash_uniq on public.photos (file_hash) where deleted_at is null and file_hash is not null;
alter table public.albums add constraint albums_cover_fk foreign key (cover_photo_id) references public.photos(id) on delete set null;

create or replace function public.photo_is_visible(p public.photos) returns boolean
language sql stable as $$
  -- Admins also see soft-deleted rows (trash / restore / empty trash).
  select public.is_admin() or (p.deleted_at is null and (
    (public.is_member() and (p.status = 'approved' or p.uploaded_by = auth.uid()))
    or (p.status = 'approved' and p.is_public)
  ))
$$;

-- Set status/visibility server-side; members cannot self-approve. Also a simple
-- rate limit (max uploads per user per hour) to protect the free storage quota.
create or replace function public.photos_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  perms jsonb := coalesce(public.setting('permissions'), '{}'::jsonb);
  recent int;
begin
  new.uploaded_by := auth.uid();
  if not public.is_admin() then
    if not coalesce((perms->>'members_can_upload')::boolean, true) then
      raise exception 'Photo uploads are currently limited to administrators';
    end if;
    select count(*) into recent from photos where uploaded_by = auth.uid() and created_at > now() - interval '1 hour';
    if recent >= coalesce((perms->>'uploads_per_hour')::int, 200) then
      raise exception 'Upload limit reached, please try again in an hour';
    end if;
    new.status := case when coalesce((perms->>'photos_need_approval')::boolean, false) then 'pending' else 'approved' end;
  end if;
  if new.is_public is null or (not public.is_admin()) then
    new.is_public := coalesce((select is_public from albums where id = new.album_id), false);
  end if;
  return new;
end $$;
create trigger photos_bi before insert on public.photos
  for each row execute function public.photos_before_insert();

create table public.photo_reactions (
  photo_id   uuid references public.photos(id) on delete cascade,
  user_id    uuid references auth.users(id) on delete cascade default auth.uid(),
  emoji      text not null default '🙏' check (emoji in ('🙏','❤️','😊','👏','🌸')),
  created_at timestamptz not null default now(),
  primary key (photo_id, user_id)
);

create table public.photo_comments (
  id         uuid primary key default gen_random_uuid(),
  photo_id   uuid not null references public.photos(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade default auth.uid(),
  body       text not null check (length(trim(body)) between 1 and 500),
  created_at timestamptz not null default now()
);
create index photo_comments_photo_idx on public.photo_comments (photo_id, created_at);

-- -----------------------------------------------------------------------------
-- Events
-- -----------------------------------------------------------------------------
create table public.events (
  id            uuid primary key default gen_random_uuid(),
  title         text not null check (length(trim(title)) between 2 and 200),
  description   text,
  category      text not null default 'other'
                check (category in ('yoga','meeting','picnic','pool_party','festival','birthday','anniversary','outing','other')),
  event_date    date not null,
  start_time    time,
  end_time      time,
  venue         text,
  cover_path    text,
  organizer     text,
  registration_info text,
  max_capacity  int check (max_capacity is null or max_capacity > 0),
  rsvp_enabled  boolean not null default true,
  instructions  text,
  status        text not null default 'scheduled' check (status in ('scheduled','cancelled','postponed')),
  is_public     boolean not null default true,
  album_id      uuid references public.albums(id) on delete set null,
  import_batch_id uuid,
  created_by    uuid references auth.users(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (end_time is null or start_time is null or end_time >= start_time)
);
create index events_date_idx on public.events (event_date);
create unique index events_dupe_uniq on public.events (lower(trim(title)), event_date);
alter table public.photos add constraint photos_event_fk foreign key (event_id) references public.events(id) on delete set null;

create table public.event_rsvps (
  event_id   uuid references public.events(id) on delete cascade,
  user_id    uuid references auth.users(id) on delete cascade default auth.uid(),
  status     text not null check (status in ('going','maybe','not_going')),
  guests     int not null default 0 check (guests between 0 and 10),
  note       text,
  updated_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

-- Capacity check runs in the database so it cannot be bypassed.
create or replace function public.rsvp_capacity_check() returns trigger
language plpgsql security definer set search_path = public as $$
declare cap int; taken int; ev_date date;
begin
  select max_capacity, event_date into cap, ev_date from events where id = new.event_id;
  if ev_date < (now() at time zone 'Asia/Kolkata')::date then
    raise exception 'RSVP is closed for past events';
  end if;
  if new.status = 'going' and cap is not null then
    select coalesce(sum(1 + guests), 0) into taken from event_rsvps
      where event_id = new.event_id and status = 'going' and user_id <> new.user_id;
    if taken + 1 + new.guests > cap then raise exception 'Sorry, this event is full'; end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger rsvp_capacity before insert or update on public.event_rsvps
  for each row execute function public.rsvp_capacity_check();

-- Display names of accounts (for comments, uploaders, RSVPs) — members only.
create or replace view public.user_names with (security_barrier = true) as
select p.id, coalesce(m.full_name, p.display_name) as name, m.photo_path, p.member_id
from public.profiles p left join public.members m on m.id = p.member_id
where public.is_member();

-- Participant names for an event (members only).
create or replace view public.event_participants with (security_barrier = true) as
select r.event_id, r.user_id, r.status, r.guests, r.note, r.updated_at,
       coalesce(m.full_name, p.display_name) as name, m.photo_path
from public.event_rsvps r
join public.profiles p on p.id = r.user_id
left join public.members m on m.id = p.member_id
where public.is_member();

-- -----------------------------------------------------------------------------
-- Announcements
-- -----------------------------------------------------------------------------
create table public.announcements (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (length(trim(title)) between 2 and 200),
  body         text not null,
  image_path   text,
  published_at timestamptz not null default now(),
  expires_at   timestamptz,
  priority     text not null default 'normal' check (priority in ('normal','important','urgent')),
  pinned       boolean not null default false,
  visibility   text not null default 'members' check (visibility in ('public','members')),
  require_read boolean not null default false,
  created_by   uuid references auth.users(id) default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index announcements_pub_idx on public.announcements (pinned desc, published_at desc);

create table public.announcement_reads (
  announcement_id uuid references public.announcements(id) on delete cascade,
  user_id         uuid references auth.users(id) on delete cascade default auth.uid(),
  read_at         timestamptz not null default now(),
  primary key (announcement_id, user_id)
);

-- -----------------------------------------------------------------------------
-- Thoughts (सुविचार), greeting templates, theme song
-- -----------------------------------------------------------------------------
create table public.thoughts (
  id         uuid primary key default gen_random_uuid(),
  text       text not null,
  author     text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.greeting_templates (
  id     uuid primary key default gen_random_uuid(),
  kind   text not null check (kind in ('birthday','anniversary')),
  lang   text not null check (lang in ('hi','en')),
  title  text not null,
  body   text not null,
  is_default boolean not null default false
);

create table public.theme_song (
  id          int primary key default 1 check (id = 1),
  title       text not null default 'Pahil Vatika Yoga Parivaar',
  description text,
  audio_path  text,
  artwork_path text,
  lyrics      text,
  lrc         text,            -- optional synchronised lyrics in LRC format
  updated_by  uuid references auth.users(id),
  updated_at  timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Excel import history
-- -----------------------------------------------------------------------------
create table public.import_batches (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('members','events','transactions')),
  file_name   text not null,
  sheet_name  text,
  total_rows  int not null default 0,
  imported    int not null default 0,
  skipped     int not null default 0,
  failed      int not null default 0,
  errors      jsonb not null default '[]',
  mapping     jsonb,
  created_by  uuid references auth.users(id) default auth.uid(),
  created_at  timestamptz not null default now()
);

-- =============================================================================
-- HISAAB-KITAB (finance). Append-only ledger: rows are never deleted; mistakes
-- are corrected by a reversal entry. Balances are always computed from rows.
-- =============================================================================
create table public.fin_categories (
  id     uuid primary key default gen_random_uuid(),
  kind   text not null check (kind in ('income','expense')),
  name   text not null,
  unique (kind, name)
);

create table public.fin_contribution_rules (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  amount         numeric(12,2) not null check (amount > 0),
  frequency      text not null default 'monthly' check (frequency in ('monthly','one_time')),
  effective_from date not null,
  effective_to   date,
  applies_to     text not null default 'all_active' check (applies_to in ('all_active')),
  active         boolean not null default true,
  created_by     uuid references auth.users(id) default auth.uid(),
  created_at     timestamptz not null default now()
);

create table public.fin_transactions (
  id             uuid primary key default gen_random_uuid(),
  txn_no         bigserial unique,
  kind           text not null check (kind in ('contribution','other_income','expense','opening_balance')),
  amount         numeric(12,2) not null check (amount > 0),
  txn_date       date not null,
  period_month   date,                         -- 1st of month the contribution is for
  member_id      uuid references public.members(id) on delete restrict,
  title          text,                         -- expense name / income source
  category       text,
  description    text,
  payment_method text check (payment_method in ('cash','upi','bank','cheque','other')),
  reference_no   text,
  paid_by        text,
  receipt_path   text,
  remarks        text,
  is_reversal    boolean not null default false,
  reverses_id    uuid unique references public.fin_transactions(id),
  reversal_reason text,
  source         text not null default 'native' check (source in ('native','excel_import','salesforce_import')),
  external_ref   text,                         -- e.g. Salesforce Credit_Debit__c record Id
  import_batch_id uuid references public.import_batches(id),
  created_by     uuid references auth.users(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_by     uuid references auth.users(id),
  updated_at     timestamptz,
  check (kind <> 'contribution' or member_id is not null),
  check ((is_reversal and reverses_id is not null) or (not is_reversal and reverses_id is null))
);
create index fin_txn_date_idx on public.fin_transactions (txn_date);
create index fin_txn_member_idx on public.fin_transactions (member_id, period_month);
create unique index fin_txn_external_uniq on public.fin_transactions (source, external_ref) where external_ref is not null;

-- Signed amount: credits positive, debits negative, reversals flip the sign.
create or replace function public.fin_signed(t public.fin_transactions) returns numeric
language sql immutable as $$
  select t.amount
       * case when t.kind = 'expense' then -1 else 1 end
       * case when t.is_reversal then -1 else 1 end
$$;

create table public.fin_audit_log (
  id         bigserial primary key,
  txn_id     uuid not null references public.fin_transactions(id),
  action     text not null check (action in ('insert','update','reverse')),
  old_values jsonb,
  new_values jsonb,
  changed_by uuid references auth.users(id),
  changed_at timestamptz not null default now()
);
create index fin_audit_txn_idx on public.fin_audit_log (txn_id, changed_at);

create or replace function public.fin_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Financial records cannot be deleted. Create a reversal entry instead.';
  end if;
  if not public.is_treasurer() then
    raise exception 'Only the treasurer or super admin can change financial records';
  end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    new.updated_by := null;
    new.updated_at := null;
    if new.kind = 'contribution' and new.period_month is null then
      new.period_month := date_trunc('month', new.txn_date)::date;
    end if;
    if new.period_month is not null then new.period_month := date_trunc('month', new.period_month)::date; end if;
    if new.is_reversal then
      if exists(select 1 from fin_transactions where id = new.reverses_id and is_reversal) then
        raise exception 'A reversal cannot itself be reversed';
      end if;
    end if;
    return new;
  end if;
  -- UPDATE: money-affecting columns are frozen; only descriptive fields may change.
  if new.amount is distinct from old.amount or new.kind is distinct from old.kind
     or new.txn_date is distinct from old.txn_date or new.member_id is distinct from old.member_id
     or new.period_month is distinct from old.period_month or new.is_reversal is distinct from old.is_reversal
     or new.reverses_id is distinct from old.reverses_id or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at or new.source is distinct from old.source
     or new.external_ref is distinct from old.external_ref then
    raise exception 'Amount, type, date and member cannot be edited. Reverse the entry and record a corrected one.';
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;
create trigger fin_guard_trg before insert or update or delete on public.fin_transactions
  for each row execute function public.fin_guard();

create or replace function public.fin_audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into fin_audit_log (txn_id, action, old_values, new_values, changed_by)
  values (new.id,
          case when tg_op = 'INSERT' and new.is_reversal then 'reverse' when tg_op = 'INSERT' then 'insert' else 'update' end,
          case when tg_op = 'UPDATE' then to_jsonb(old) end,
          to_jsonb(new), auth.uid());
  return new;
end $$;
create trigger fin_audit_trg after insert or update on public.fin_transactions
  for each row execute function public.fin_audit();

-- Reverse an entry (atomic). Returns the id of the new reversal row.
create or replace function public.fin_reverse(p_txn uuid, p_reason text) returns uuid
language plpgsql security invoker set search_path = public as $$
declare o fin_transactions; nid uuid;
begin
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required'; end if;
  select * into o from fin_transactions where id = p_txn;
  if not found then raise exception 'Transaction not found'; end if;
  insert into fin_transactions (kind, amount, txn_date, period_month, member_id, title, category,
                                description, payment_method, is_reversal, reverses_id, reversal_reason, remarks)
  values (o.kind, o.amount, (now() at time zone 'Asia/Kolkata')::date, o.period_month, o.member_id,
          coalesce(o.title, o.kind) || ' (reversal of #' || o.txn_no || ')', o.category, o.description,
          o.payment_method, true, o.id, p_reason, p_reason)
  returning id into nid;
  return nid;
end $$;

-- Ledger with signed amounts and reversal status, for reports.
create or replace view public.fin_ledger with (security_invoker = true) as
select t.*, public.fin_signed(t) as signed_amount,
       exists(select 1 from public.fin_transactions r where r.reverses_id = t.id) as is_reversed,
       m.full_name as member_name
from public.fin_transactions t
left join public.member_directory m on m.id = t.member_id;

-- Monthly totals (net of reversals).
create or replace view public.fin_monthly with (security_invoker = true) as
select date_trunc('month', txn_date)::date as month,
       sum(case when kind <> 'expense' then public.fin_signed(t) else 0 end) as collection,
       sum(case when kind = 'expense' then -public.fin_signed(t) else 0 end) as expenditure,
       sum(public.fin_signed(t)) as net
from public.fin_transactions t
group by 1;

-- Expected vs paid contributions per active member per month, from the rules.
create or replace function public.fin_member_dues(p_from date, p_to date)
returns table (member_id uuid, member_name text, period_month date, expected numeric, paid numeric, status text)
language sql stable security definer set search_path = public as $$
  with months as (
    select generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month')::date as m
  ),
  expected as (
    select mo.m, sum(r.amount) as amt
    from months mo
    join fin_contribution_rules r on r.active and r.frequency = 'monthly'
      and mo.m >= date_trunc('month', r.effective_from)
      and (r.effective_to is null or mo.m <= r.effective_to)
    group by mo.m
  ),
  paid as (
    select t.member_id, t.period_month, sum(public.fin_signed(t)) as amt
    from fin_transactions t where t.kind = 'contribution'
    group by 1, 2
  )
  select mem.id, mem.full_name, e.m, e.amt, coalesce(p.amt, 0),
         case when coalesce(p.amt,0) >= e.amt then 'paid' when coalesce(p.amt,0) > 0 then 'partial' else 'pending' end
  from expected e
  cross join members mem
  left join paid p on p.member_id = mem.id and p.period_month = e.m
  where mem.status = 'active' and (mem.joining_date is null or e.m >= date_trunc('month', mem.joining_date))
    and public.finance_visible()
  order by e.m, mem.full_name
$$;

-- -----------------------------------------------------------------------------
-- General audit log for non-financial content
-- -----------------------------------------------------------------------------
create table public.audit_log (
  id         bigserial primary key,
  table_name text not null,
  record_id  text,
  action     text not null,
  actor      uuid default auth.uid(),
  old_data   jsonb,
  new_data   jsonb,
  at         timestamptz not null default now()
);
create index audit_log_at_idx on public.audit_log (at desc);

create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log (table_name, record_id, action, old_data, new_data)
  values (tg_table_name,
          coalesce((case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end)->>'id',
                   (case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end)->>'key'),
          lower(tg_op),
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['members','profiles','albums','photos','events','announcements','site_settings',
                           'theme_song','fin_contribution_rules','fin_categories','greeting_templates','thoughts']
  loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row()',
                   t || '_audit', t);
  end loop;
end $$;

-- Public statistics for the homepage (counts only — no private data).
create or replace function public.site_stats() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'members', (select count(*) from members where status = 'active'),
    'photos',  (select count(*) from photos where deleted_at is null and status = 'approved'),
    'events',  (select count(*) from events where status <> 'cancelled'),
    'celebrations', (select count(*) from events where category in ('birthday','anniversary','festival')
                       and status <> 'cancelled')
                    + (select count(*) from photos p join albums a on a.id = p.album_id
                       where p.deleted_at is null and a.name in ('Birthday Celebrations','Anniversary Celebrations'))
  )
$$;

-- Storage used by the gallery (admins watch the free-tier quota).
create or replace function public.storage_usage() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when public.is_admin() then jsonb_build_object(
    'bytes', coalesce((select sum((metadata->>'size')::bigint) from storage.objects), 0),
    'objects', (select count(*) from storage.objects)) end
$$;

-- =============================================================================
-- Row-level security
-- =============================================================================
alter table public.profiles enable row level security;
alter table public.site_settings enable row level security;
alter table public.members enable row level security;
alter table public.albums enable row level security;
alter table public.photos enable row level security;
alter table public.photo_reactions enable row level security;
alter table public.photo_comments enable row level security;
alter table public.events enable row level security;
alter table public.event_rsvps enable row level security;
alter table public.announcements enable row level security;
alter table public.announcement_reads enable row level security;
alter table public.thoughts enable row level security;
alter table public.greeting_templates enable row level security;
alter table public.theme_song enable row level security;
alter table public.import_batches enable row level security;
alter table public.fin_categories enable row level security;
alter table public.fin_contribution_rules enable row level security;
alter table public.fin_transactions enable row level security;
alter table public.fin_audit_log enable row level security;
alter table public.audit_log enable row level security;

-- profiles
create policy "own profile or admin" on public.profiles for select using (id = auth.uid() or public.is_admin());
create policy "update own profile" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
create policy "admin updates profiles" on public.profiles for update using (public.is_admin());

-- settings
create policy "settings readable" on public.site_settings for select using (true);
create policy "admin writes settings" on public.site_settings for all using (public.is_admin()) with check (public.is_admin());

-- members: raw table for admins and self only; everyone else uses member_directory
create policy "admin or self reads members" on public.members for select using (public.is_admin() or user_id = auth.uid());
create policy "admin inserts members" on public.members for insert with check (public.is_admin());
create policy "admin or self updates members" on public.members for update using (public.is_admin() or user_id = auth.uid());
create policy "super admin deletes members" on public.members for delete using (public.is_super_admin());

-- albums
create policy "albums visible" on public.albums for select using (public.is_member() or is_public);
create policy "admin manages albums" on public.albums for all using (public.is_admin()) with check (public.is_admin());

-- photos
create policy "photos visible" on public.photos for select using (public.photo_is_visible(photos));
create policy "members upload" on public.photos for insert with check (public.is_member());
create policy "admin manages photos" on public.photos for update using (public.is_admin());
create policy "uploader edits caption" on public.photos for update using (uploaded_by = auth.uid() and deleted_at is null)
  with check (uploaded_by = auth.uid());
create policy "admin hard-deletes photos" on public.photos for delete using (public.is_admin());

create or replace function public.guard_photo_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    if new.status is distinct from old.status or new.is_public is distinct from old.is_public
       or new.storage_path is distinct from old.storage_path or new.uploaded_by is distinct from old.uploaded_by
       or new.file_hash is distinct from old.file_hash then
      raise exception 'Only admins can change photo status';
    end if;
    -- uploaders may soft-delete their own photo
    if new.deleted_at is not null and old.deleted_at is null then new.deleted_by := auth.uid(); end if;
  end if;
  return new;
end $$;
create trigger photos_guard before update on public.photos
  for each row execute function public.guard_photo_update();

-- reactions & comments
create policy "reactions visible" on public.photo_reactions for select using (public.is_member());
create policy "react as self" on public.photo_reactions for all using (user_id = auth.uid() and public.is_member())
  with check (user_id = auth.uid() and public.is_member());
create policy "comments visible" on public.photo_comments for select using (public.is_member());
create policy "comment as self" on public.photo_comments for insert with check (user_id = auth.uid() and public.is_member());
create policy "delete own comment or admin" on public.photo_comments for delete using (user_id = auth.uid() or public.is_admin());

-- events & RSVPs
create policy "events visible" on public.events for select using (is_public or public.is_member());
create policy "admin manages events" on public.events for all using (public.is_admin()) with check (public.is_admin());
create policy "rsvps visible to members" on public.event_rsvps for select using (public.is_member());
create policy "rsvp as self" on public.event_rsvps for insert with check (user_id = auth.uid() and public.is_member());
create policy "update own rsvp" on public.event_rsvps for update using (user_id = auth.uid());
create policy "delete own rsvp" on public.event_rsvps for delete using (user_id = auth.uid() or public.is_admin());

-- announcements
create policy "announcements visible" on public.announcements for select
  using (public.is_admin() or ((visibility = 'public' or public.is_member()) and published_at <= now()));
create policy "admin manages announcements" on public.announcements for all using (public.is_admin()) with check (public.is_admin());
create policy "read receipts visible" on public.announcement_reads for select using (user_id = auth.uid() or public.is_admin());
create policy "mark read" on public.announcement_reads for insert with check (user_id = auth.uid() and public.is_member());

-- thoughts, greetings, song
create policy "thoughts readable" on public.thoughts for select using (true);
create policy "admin manages thoughts" on public.thoughts for all using (public.is_admin()) with check (public.is_admin());
create policy "greetings readable" on public.greeting_templates for select using (true);
create policy "admin manages greetings" on public.greeting_templates for all using (public.is_admin()) with check (public.is_admin());
create policy "song readable" on public.theme_song for select using (true);
create policy "admin manages song" on public.theme_song for all using (public.is_admin()) with check (public.is_admin());

-- imports
create policy "staff read imports" on public.import_batches for select using (public.is_admin() or public.is_treasurer());
create policy "staff create imports" on public.import_batches for insert
  with check ((kind = 'transactions' and public.is_treasurer()) or (kind <> 'transactions' and public.is_admin()));
create policy "staff update imports" on public.import_batches for update using (created_by = auth.uid());

-- finance (no DELETE policy anywhere: deletion is impossible through the API)
create policy "finance readable" on public.fin_transactions for select using (public.finance_visible());
create policy "treasurer inserts" on public.fin_transactions for insert with check (public.is_treasurer());
create policy "treasurer updates" on public.fin_transactions for update using (public.is_treasurer());
create policy "rules readable" on public.fin_contribution_rules for select using (public.finance_visible());
create policy "treasurer manages rules" on public.fin_contribution_rules for all using (public.is_treasurer()) with check (public.is_treasurer());
create policy "categories readable" on public.fin_categories for select using (public.is_member());
create policy "treasurer manages categories" on public.fin_categories for all using (public.is_treasurer()) with check (public.is_treasurer());
create policy "fin audit readable" on public.fin_audit_log for select using (public.is_treasurer() or public.is_admin());

-- general audit
create policy "admin reads audit" on public.audit_log for select using (public.is_admin());

-- Views are owner-rights only where they mask data themselves.
grant select on public.member_directory, public.event_participants, public.user_names to anon, authenticated;
grant select on public.fin_ledger, public.fin_monthly to authenticated;
revoke execute on function public.fin_reverse(uuid, text) from public, anon;

-- =============================================================================
-- Storage buckets & policies
--   site     : public  — hero image, theme song, artwork, event covers, announcement images
--   gallery  : private — photos, videos, thumbnails, originals, member avatars (signed URLs)
--   receipts : private — expense receipts
-- File-size limits keep within the Supabase free tier (50 MB per file).
-- =============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('site', 'site', true, 52428800, array['image/jpeg','image/png','image/webp','audio/mpeg','audio/mp3','audio/mp4','audio/x-m4a','audio/aac','audio/wav']),
  ('gallery', 'gallery', false, 52428800, array['image/jpeg','image/png','image/webp','video/mp4','video/webm','video/quicktime']),
  ('receipts', 'receipts', false, 10485760, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do nothing;

create policy "site public read" on storage.objects for select using (bucket_id = 'site');
create policy "site admin write" on storage.objects for insert with check (bucket_id = 'site' and public.is_admin());
create policy "site admin update" on storage.objects for update using (bucket_id = 'site' and public.is_admin());
create policy "site admin delete" on storage.objects for delete using (bucket_id = 'site' and public.is_admin());

create policy "gallery read" on storage.objects for select using (
  bucket_id = 'gallery' and (
    public.is_member()
    or exists (select 1 from public.photos p
               where p.deleted_at is null and p.status = 'approved' and p.is_public
                 and name in (p.storage_path, p.thumb_path))
    or exists (select 1 from public.members m where m.is_public and m.status = 'active' and m.photo_path = name)
  ));
-- Members upload only into their own folder: gallery/u/<uid>/...
create policy "gallery member upload" on storage.objects for insert with check (
  bucket_id = 'gallery' and public.is_member()
  and ((storage.foldername(name))[1] = 'u' and (storage.foldername(name))[2] = auth.uid()::text
       or (storage.foldername(name))[1] = 'avatars' and public.is_member()
       or public.is_admin()));
create policy "gallery admin delete" on storage.objects for delete using (bucket_id = 'gallery' and public.is_admin());
create policy "gallery avatar update" on storage.objects for update using (bucket_id = 'gallery' and public.is_member()
  and (storage.foldername(name))[1] = 'avatars');

create policy "receipts read" on storage.objects for select using (bucket_id = 'receipts' and public.finance_visible());
create policy "receipts treasurer write" on storage.objects for insert with check (bucket_id = 'receipts' and public.is_treasurer());

-- =============================================================================
-- Defaults (editable from the admin dashboard). No member or financial data here.
-- =============================================================================
insert into public.site_settings (key, value) values
  ('site', jsonb_build_object(
     'name_hi', 'पाहिल वाटिका योगा ग्रुप, खजुराहो',
     'name_en', 'Pahil Vatika Yoga Group, Khajuraho',
     'family_hi', 'पाहिल वाटिका योग परिवार',
     'tagline', 'एक परिवार, एक पहचान।',
     'subtagline', 'योग से स्वास्थ्य, साथ से खुशियाँ।',
     'message', 'यह सिर्फ एक योगा ग्रुप नहीं, हमारा अपना परिवार है।',
     'intro', '',
     'hero_path', null,
     'group_photo_path', null,
     'contact_phone', '',
     'contact_email', '',
     'address', 'पाहिल वाटिका, खजुराहो, मध्य प्रदेश',
     'session_time', '',
     'whatsapp_group', '')),
  ('permissions', jsonb_build_object(
     'members_can_upload', true,
     'photos_need_approval', false,
     'keep_originals', false,
     'uploads_per_hour', 200,
     'max_batch', 30,
     'max_image_mb', 25,
     'max_video_mb', 50,
     'finance_visible_to_members', true,
     'members_edit_own_profile', true,
     'allow_comments', true)),
  ('hisaab', jsonb_build_object(
     'legacy_url', 'https://resilient-koala-m1f4xi-dev-ed.trailblaze.my.site.com/credit-debit',
     'legacy_name', 'Hisaab-Kitab (Salesforce)',
     'currency', 'INR'))
on conflict (key) do nothing;

insert into public.theme_song (id, title, description) values
  (1, 'Pahil Vatika Yoga Parivaar', 'पाहिल वाटिका योग परिवार का अपना गीत')
on conflict (id) do nothing;

insert into public.albums (name, description, is_public, sort_order) values
  ('Morning Yoga', 'सुबह का योग और प्राणायाम', true, 1),
  ('Group Memories', 'परिवार की यादें', false, 2),
  ('Birthday Celebrations', 'जन्मदिन समारोह', false, 3),
  ('Anniversary Celebrations', 'सालगिरह समारोह', false, 4),
  ('Community Gatherings', 'सामुदायिक मिलन', false, 5),
  ('Picnics and Outings', 'पिकनिक और सैर', false, 6),
  ('Festivals', 'त्योहार', false, 7),
  ('Special Events', 'विशेष आयोजन', false, 8)
on conflict (name) do nothing;

insert into public.greeting_templates (kind, lang, title, body, is_default) values
  ('birthday', 'hi', 'जन्मदिन की हार्दिक शुभकामनाएँ!',
   E'आपका जीवन स्वस्थ, सुखमय और खुशियों से भरा रहे।\n\nपाहिल वाटिका योगा ग्रुप की ओर से ढेर सारा प्यार और शुभकामनाएँ।', true),
  ('birthday', 'en', 'Happy Birthday!',
   E'Wishing you a healthy, peaceful and joyful year ahead.\n\nWith love and best wishes from the Pahil Vatika Yoga Parivaar.', false),
  ('anniversary', 'hi', 'विवाह वर्षगाँठ की हार्दिक शुभकामनाएँ!',
   E'आपका दाम्पत्य जीवन प्रेम, स्वास्थ्य और खुशियों से सदा भरा रहे।\n\nपाहिल वाटिका योगा ग्रुप की ओर से ढेर सारी शुभकामनाएँ।', true),
  ('anniversary', 'en', 'Happy Anniversary!',
   E'May your togetherness always be filled with love, health and happiness.\n\nWarm wishes from the Pahil Vatika Yoga Parivaar.', false);

-- Classical sayings (public domain) to start the सुविचार rotation; admins can add their own.
insert into public.thoughts (text, author) values
  ('योगः कर्मसु कौशलम्।', 'श्रीमद्भगवद्गीता 2.50'),
  ('शरीरमाद्यं खलु धर्मसाधनम्।', 'कालिदास, कुमारसम्भवम्'),
  ('योगश्चित्तवृत्तिनिरोधः।', 'पतंजलि योगसूत्र 1.2'),
  ('सर्वे भवन्तु सुखिनः, सर्वे सन्तु निरामयाः।', 'वैदिक प्रार्थना'),
  ('समत्वं योग उच्यते।', 'श्रीमद्भगवद्गीता 2.48'),
  ('वसुधैव कुटुम्बकम्।', 'महोपनिषद्');

insert into public.fin_categories (kind, name) values
  ('income', 'Monthly contribution'), ('income', 'Chai-chappa'), ('income', 'Event contribution'), ('income', 'Donation'),
  ('expense', 'Chai-chappa'), ('expense', 'Event / celebration'), ('expense', 'Picnic / outing'),
  ('expense', 'Yoga equipment'), ('expense', 'Garden / venue'), ('expense', 'Gifts'), ('expense', 'Other')
on conflict do nothing;
