-- Performance snapshots — per-tick derived metric for the active baseline.
-- One row per cron run. Captures portfolio/SPY/BTC % since baseline along
-- with the raw dollar + benchmark price values used in that computation.
--
-- Links to analytics_baseline(id) so a future "reset baseline" cascade-deletes
-- the old % history (which would be wrong against the new anchor anyway).
create table if not exists performance_snapshots (
  id              uuid primary key default gen_random_uuid(),
  baseline_id     uuid references analytics_baseline(id) on delete cascade,
  baseline_date   date not null,
  timestamp       timestamptz not null,
  portfolio_usd   numeric not null,
  crypto_usd      numeric not null,
  combined_usd    numeric not null,
  deposits_usd    numeric not null default 0,
  spy_price_usd   numeric,
  btc_price_usd   numeric,
  portfolio_pct   numeric,
  spy_pct         numeric,
  btc_pct         numeric,
  created_at      timestamptz not null default now()
);

create index if not exists performance_snapshots_baseline_timestamp_idx
  on performance_snapshots (baseline_id, timestamp desc);
