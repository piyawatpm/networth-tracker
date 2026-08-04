"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Lock } from "lucide-react";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (signInError) {
      setError(signInError.message);
      setBusy(false);
      return;
    }

    // Only ever redirect to a path on this origin — a `next` of
    // "https://evil.example" would otherwise make this an open redirect.
    const next = params.get("next");
    const target = next && next.startsWith("/") && !next.startsWith("//")
      ? next
      : "/dashboard";

    // refresh() so the middleware re-runs and sees the new session cookie.
    router.replace(target);
    router.refresh();
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="finance-card w-full max-w-sm p-6">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary">
            <Lock className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Vesta</h1>
            <p className="text-xs text-muted-foreground">Sign in to continue</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label htmlFor="email" className="label-mono mb-1 block">
              Email
            </label>
            <Input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="password" className="label-mono mb-1 block">
              Password
            </label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error && <p className="text-xs text-expense">{error}</p>}

          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
