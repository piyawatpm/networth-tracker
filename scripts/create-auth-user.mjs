#!/usr/bin/env node
/**
 * Create (or re-password) the single Supabase Auth user that the app signs in
 * as. Run this BEFORE applying lib/supabase/rls.sql — once RLS is on, a
 * database without a usable account locks you out of your own data.
 *
 *   node scripts/create-auth-user.mjs <email> [password]
 *
 * Omit the password and one is generated and printed. Reads credentials from
 * .env.local; nothing is written to disk.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

function loadEnv() {
  const env = {};
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // Fall through to process.env — useful in CI.
  }
  return { ...env, ...process.env };
}

const env = loadEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const secret = env.SUPABASE_SECRET_KEY;

if (!url || !secret) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY.");
  process.exit(1);
}

const email = process.argv[2];
if (!email) {
  console.error("Usage: node scripts/create-auth-user.mjs <email> [password]");
  process.exit(1);
}

// URL-safe, no ambiguous characters to mistype from a password manager.
const password = process.argv[3] ?? randomBytes(24).toString("base64url");

const supabase = createClient(url, secret, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: existing } = await supabase.auth.admin.listUsers({ perPage: 200 });
const match = existing?.users?.find(
  (u) => u.email?.toLowerCase() === email.toLowerCase(),
);

if (match) {
  const { error } = await supabase.auth.admin.updateUserById(match.id, {
    password,
    email_confirm: true,
  });
  if (error) {
    console.error("Failed to update user:", error.message);
    process.exit(1);
  }
  console.log(`Updated password for existing user ${email}`);
} else {
  const { error } = await supabase.auth.admin.createUser({
    email,
    password,
    // No inbox round trip — this is a single-owner app, not a signup flow.
    email_confirm: true,
  });
  if (error) {
    console.error("Failed to create user:", error.message);
    process.exit(1);
  }
  console.log(`Created user ${email}`);
}

if (!process.argv[3]) {
  console.log(`\n  password: ${password}\n`);
  console.log("Save this in your password manager — it is not stored anywhere.");
}
