-- =============================================================================
-- Row Level Security
-- =============================================================================
-- Until this runs, the publishable key alone grants full read AND write access
-- to every table. That key ships inside the deployed JavaScript bundle, so
-- anyone who opened devtools on the live site could read or overwrite the
-- entire financial history.
--
-- After this runs, the publishable key can do nothing on its own — a request
-- must carry a signed session JWT from a real sign-in.
--
-- -----------------------------------------------------------------------------
-- ORDER MATTERS. Run this ONLY AFTER the auth build is deployed.
-- -----------------------------------------------------------------------------
-- The currently deployed site has no login screen. Applying this first cuts it
-- off from its own data and every page renders empty until the new build ships.
--
--   1. Create the auth user (see scripts/create-auth-user.mjs)
--   2. Deploy the branch with middleware.ts + /login
--   3. Sign in on the deployed site and confirm data loads
--   4. THEN run this file
--
-- Server-side code is unaffected either way: the snapshot cron and the iOS
-- quick-add endpoint use SUPABASE_SECRET_KEY, and the service role bypasses RLS
-- entirely.
--
-- Idempotent — safe to re-run.
-- =============================================================================

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'app_data',
    'income_entries',
    'expense_entries',
    'recurring_income_templates',
    'recurring_expense_templates',
    'portfolio_holdings',
    'portfolio_transactions',
    'debt_records',
    'debt_transactions',
    'snapshots',
    'cron_logs',
    'networth_goals',
    'custom_categories'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    -- Skip anything not present, so a partially-migrated database still works.
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      RAISE NOTICE 'skipping % (does not exist)', t;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    -- Single owner, so "signed in" is the whole authorization model. There is
    -- no per-row ownership column to check against.
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_authenticated_all', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
      t || '_authenticated_all', t
    );

    -- Remove any anon grant left over from the open era. Without this the
    -- table stays world-writable and enabling RLS achieves nothing.
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_anon_all', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- Verify: every table should show rowsecurity = true and exactly one policy.
-- -----------------------------------------------------------------------------
-- SELECT c.relname,
--        c.relrowsecurity AS rls_enabled,
--        count(p.polname)  AS policies
-- FROM pg_class c
-- JOIN pg_namespace n ON n.oid = c.relnamespace
-- LEFT JOIN pg_policy p ON p.polrelid = c.oid
-- WHERE n.nspname = 'public' AND c.relkind = 'r'
-- GROUP BY c.relname, c.relrowsecurity
-- ORDER BY c.relname;
