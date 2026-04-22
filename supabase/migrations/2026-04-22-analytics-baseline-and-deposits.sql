-- Analytics baseline — stores a snapshot of "where the user started tracking".
-- Only one row has is_current=true at any time; past baselines are retained.
create table if not exists analytics_baseline (
  id          uuid primary key default gen_random_uuid(),
  date        date not null,
  created_at  timestamptz not null default now(),
  snapshot    jsonb not null,
  is_current  boolean not null default true
);

create unique index if not exists analytics_baseline_current_idx
  on analytics_baseline (is_current) where is_current;

-- Crypto deposit ledger — external capital inflows to crypto (matches
-- portfolio_transactions for stocks).
create table if not exists crypto_deposits (
  id                    uuid primary key default gen_random_uuid(),
  date                  timestamptz not null,
  token                 text not null,
  amount                numeric not null,
  usd_value_at_deposit  numeric not null,
  kind                  text not null check (kind in ('stablecoin', 'crypto')),
  notes                 text,
  created_at            timestamptz not null default now()
);

create index if not exists crypto_deposits_date_idx on crypto_deposits (date desc);
