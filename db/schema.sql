-- Monday 21: run this once in your Postgres database (Supabase: SQL editor > New query > paste > Run).

create table if not exists games (
  id          text primary key,              -- game date in Nairobi time, e.g. 2026-11-16
  kickoff_at  timestamptz not null,
  capacity    int not null check (capacity > 0),
  price       int not null check (price > 0),
  created_at  timestamptz not null default now()
);

create table if not exists spots (
  id                   uuid primary key default gen_random_uuid(),
  game_id              text not null references games(id),
  slot                 int,                  -- null once a spot is released
  name                 text not null,
  name_key             text not null,
  phone                text not null,        -- 2547XXXXXXXX, never sent to browsers in full
  status               text not null default 'pending'
                       check (status in ('pending', 'paid', 'failed', 'removed', 'refund_due')),
  amount               int not null,
  checkout_request_id  text unique,
  merchant_request_id  text,
  receipt              text unique,          -- M-Pesa receipt; unique blocks replayed callbacks
  result_code          int,
  result_desc          text,
  ip                   text,
  held_until           timestamptz not null,
  paid_at              timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (game_id, slot),                    -- two people can never hold the same spot
  check (slot is null or slot > 0)
);

create index if not exists spots_game_status   on spots (game_id, status);
create index if not exists spots_phone_created on spots (phone, created_at);
create index if not exists spots_ip_created    on spots (ip, created_at);
create index if not exists spots_pending_hold  on spots (held_until) where status = 'pending';

-- Supabase exposes tables through its public API. Turning on row level security with
-- no policies blocks that API completely, so phone numbers can only be read by this app's server.
alter table games enable row level security;
alter table spots enable row level security;
