-- =============================================================================
-- Migration: Add relational tables
-- =============================================================================
-- This migration is ADDITIVE. It creates new relational tables alongside the
-- existing `app_data` key-value table. The `app_data` table is NOT touched.
--
-- All statements use CREATE TABLE IF NOT EXISTS for full idempotency —
-- safe to run multiple times without side effects.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. income_entries
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS income_entries (
  id                TEXT        PRIMARY KEY,
  type              TEXT        NOT NULL DEFAULT 'other',
  description       TEXT        DEFAULT '',
  amount            NUMERIC     NOT NULL DEFAULT 0,
  currency          TEXT        DEFAULT 'AUD',
  date              TEXT        NOT NULL,  -- YYYY-MM-DD
  source            TEXT        DEFAULT '',
  notes             TEXT        DEFAULT '',
  is_passive        BOOLEAN,
  is_recurring      BOOLEAN     DEFAULT false,
  recurring_id      TEXT,
  created_at        BIGINT      NOT NULL   -- unix timestamp ms
);

CREATE INDEX IF NOT EXISTS income_entries_date_idx ON income_entries (date);
CREATE INDEX IF NOT EXISTS income_entries_type_idx ON income_entries (type);

-- ---------------------------------------------------------------------------
-- 2. expense_entries
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS expense_entries (
  id                TEXT        PRIMARY KEY,
  type              TEXT        NOT NULL DEFAULT 'other',
  description       TEXT        DEFAULT '',
  amount            NUMERIC     NOT NULL DEFAULT 0,
  currency          TEXT        DEFAULT 'AUD',
  vendor            TEXT        DEFAULT '',
  date              TEXT        NOT NULL,  -- YYYY-MM-DD
  notes             TEXT        DEFAULT '',
  images            JSONB       DEFAULT '[]',  -- base64 strings
  payment_method    TEXT        DEFAULT 'other',
  is_recurring      BOOLEAN     DEFAULT false,
  recurring_id      TEXT,
  is_one_off        BOOLEAN     DEFAULT false,
  created_at        BIGINT      NOT NULL   -- unix timestamp ms
);

CREATE INDEX IF NOT EXISTS expense_entries_date_idx ON expense_entries (date);
CREATE INDEX IF NOT EXISTS expense_entries_type_idx ON expense_entries (type);

-- ---------------------------------------------------------------------------
-- 3. recurring_income_templates
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recurring_income_templates (
  id                    TEXT        PRIMARY KEY,
  type                  TEXT        NOT NULL DEFAULT 'other',
  description           TEXT        DEFAULT '',
  amount                NUMERIC     NOT NULL DEFAULT 0,
  currency              TEXT        DEFAULT 'AUD',
  source                TEXT        DEFAULT '',
  notes                 TEXT        DEFAULT '',
  frequency             TEXT        NOT NULL,  -- weekly|fortnightly|monthly|yearly
  start_date            TEXT        NOT NULL,
  end_date              TEXT,
  last_generated_date   TEXT,
  active                BOOLEAN     DEFAULT true,
  is_passive            BOOLEAN,
  created_at            BIGINT      NOT NULL   -- unix timestamp ms
);

-- ---------------------------------------------------------------------------
-- 4. recurring_expense_templates
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recurring_expense_templates (
  id                    TEXT        PRIMARY KEY,
  type                  TEXT        NOT NULL DEFAULT 'other',
  description           TEXT        DEFAULT '',
  amount                NUMERIC     NOT NULL DEFAULT 0,
  currency              TEXT        DEFAULT 'AUD',
  vendor                TEXT        DEFAULT '',
  payment_method        TEXT        DEFAULT 'other',
  notes                 TEXT        DEFAULT '',
  frequency             TEXT        NOT NULL,  -- weekly|fortnightly|monthly|yearly
  start_date            TEXT        NOT NULL,
  end_date              TEXT,
  last_generated_date   TEXT,
  active                BOOLEAN     DEFAULT true,
  created_at            BIGINT      NOT NULL   -- unix timestamp ms
);

-- ---------------------------------------------------------------------------
-- 5. portfolio_holdings
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS portfolio_holdings (
  id                TEXT        PRIMARY KEY,
  name              TEXT        DEFAULT '',
  ticker            TEXT        DEFAULT '',
  type              TEXT        DEFAULT 'stock',  -- stock|etf|fund|bond|savings|other
  account_type      TEXT        DEFAULT 'normal', -- normal|super
  broker            TEXT        DEFAULT '',
  country           TEXT        DEFAULT '',
  link              TEXT        DEFAULT '',
  units             NUMERIC     DEFAULT 0,
  amount_invested   NUMERIC     DEFAULT 0,
  current_value     NUMERIC     DEFAULT 0,
  currency          TEXT        DEFAULT 'AUD',
  notes             TEXT        DEFAULT '',
  is_emergency_fund BOOLEAN,
  is_cash           BOOLEAN,
  created_at        BIGINT      NOT NULL   -- unix timestamp ms
);

CREATE INDEX IF NOT EXISTS portfolio_holdings_ticker_idx ON portfolio_holdings (ticker);

-- ---------------------------------------------------------------------------
-- 6. portfolio_transactions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS portfolio_transactions (
  id              TEXT        PRIMARY KEY,
  holding_id      TEXT        NOT NULL,
  holding_name    TEXT        DEFAULT '',
  type            TEXT        NOT NULL,  -- buy|sell
  units           NUMERIC     NOT NULL DEFAULT 0,
  price_per_unit  NUMERIC     NOT NULL DEFAULT 0,
  total_amount    NUMERIC     NOT NULL DEFAULT 0,
  currency        TEXT        DEFAULT 'AUD',
  date            TEXT        NOT NULL,  -- YYYY-MM-DD
  notes           TEXT        DEFAULT '',
  created_at      BIGINT      NOT NULL   -- unix timestamp ms
);

CREATE INDEX IF NOT EXISTS portfolio_transactions_holding_id_idx ON portfolio_transactions (holding_id);
CREATE INDEX IF NOT EXISTS portfolio_transactions_date_idx       ON portfolio_transactions (date);

-- ---------------------------------------------------------------------------
-- 7. debt_records
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS debt_records (
  id              TEXT        PRIMARY KEY,
  person          TEXT        NOT NULL DEFAULT '',
  direction       TEXT        NOT NULL DEFAULT 'i_owe',  -- i_owe|owed_to_me
  reason          TEXT        DEFAULT '',
  original_amount NUMERIC     NOT NULL DEFAULT 0,
  currency        TEXT        DEFAULT 'AUD',
  notes           TEXT        DEFAULT '',
  images          JSONB       DEFAULT '[]',
  created_at      BIGINT      NOT NULL   -- unix timestamp ms
);

-- ---------------------------------------------------------------------------
-- 8. debt_transactions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS debt_transactions (
  id          TEXT        PRIMARY KEY,
  debt_id     TEXT        NOT NULL,
  amount      NUMERIC     NOT NULL DEFAULT 0,
  date        TEXT        NOT NULL,  -- YYYY-MM-DD
  notes       TEXT        DEFAULT '',
  images      JSONB       DEFAULT '[]',
  created_at  BIGINT      NOT NULL   -- unix timestamp ms
);

CREATE INDEX IF NOT EXISTS debt_transactions_debt_id_idx ON debt_transactions (debt_id);

-- ---------------------------------------------------------------------------
-- 9. snapshots  (portfolio | crypto | networth)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS snapshots (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  type              TEXT        NOT NULL,   -- portfolio|crypto|networth
  date              TEXT        NOT NULL,   -- Sydney datetime string
  value             NUMERIC     NOT NULL DEFAULT 0,
  value_no_super    NUMERIC,               -- networth only
  value_with_super  NUMERIC,               -- portfolio only
  portfolio         NUMERIC,               -- networth only
  crypto            NUMERIC,               -- networth only
  currency          TEXT        DEFAULT 'USD',
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS snapshots_type_date_idx ON snapshots (type, date);

-- ---------------------------------------------------------------------------
-- 10. cron_logs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cron_logs (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  date        TEXT        NOT NULL,
  timestamp   TIMESTAMPTZ NOT NULL DEFAULT now(),
  success     BOOLEAN     NOT NULL DEFAULT false,
  log         JSONB       DEFAULT '[]',
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cron_logs_date_desc_idx ON cron_logs (date DESC);

-- ---------------------------------------------------------------------------
-- 11. networth_goals
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS networth_goals (
  id          TEXT    PRIMARY KEY,
  name        TEXT    DEFAULT '',
  amount      NUMERIC NOT NULL DEFAULT 0,
  currency    TEXT    DEFAULT 'AUD',
  set_at      BIGINT  NOT NULL,   -- unix timestamp ms
  achieved_at BIGINT              -- unix timestamp ms, null until achieved
);

-- ---------------------------------------------------------------------------
-- 12. custom_categories  (income + expense, discriminated by kind)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS custom_categories (
  id      TEXT    NOT NULL,
  kind    TEXT    NOT NULL,  -- 'income' or 'expense'
  label   TEXT    NOT NULL DEFAULT '',
  color   TEXT    NOT NULL DEFAULT '#888888',
  PRIMARY KEY (id, kind)
);
