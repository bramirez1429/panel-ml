create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  password_hash text not null,
  name text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_email_unique unique (email),
  constraint users_email_normalized_check
    check (email = lower(btrim(email))),
  constraint users_email_length_check
    check (char_length(email) between 3 and 254),
  constraint users_password_hash_not_empty_check
    check (char_length(password_hash) > 0),
  constraint users_name_not_blank_check
    check (name is null or char_length(btrim(name)) > 0)
);

create table if not exists public.user_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint user_sessions_token_hash_unique unique (token_hash),
  constraint user_sessions_token_hash_check
    check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint user_sessions_expiration_check
    check (
      expires_at > created_at
      and expires_at <= created_at + interval '24 hours'
    )
);

create index if not exists idx_user_sessions_user_created
  on public.user_sessions (user_id, created_at desc);

alter table public.users enable row level security;
alter table public.user_sessions enable row level security;
