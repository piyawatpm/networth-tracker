// app/api/analytics/baseline/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { AnalyticsBaseline } from "@/lib/utils/types";
import { deriveAndPersistBaseline } from "@/lib/utils/analytics-derive";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
);

export async function GET() {
  const existing = await supabase
    .from("analytics_baseline")
    .select("snapshot")
    .eq("is_current", true)
    .maybeSingle();

  if (existing.error) {
    return NextResponse.json({ error: existing.error.message }, { status: 500 });
  }
  if (existing.data) {
    return NextResponse.json({
      baseline: existing.data.snapshot as AnalyticsBaseline,
    });
  }

  // No baseline yet — auto-derive from earliest snapshot.
  const result = await deriveAndPersistBaseline({ supabase });
  if (!result.ok) {
    if (result.status === 400 && result.error.startsWith("No snapshots yet")) {
      // Brand-new install — surface as null baseline (NoBaselineEmpty path).
      return NextResponse.json({ baseline: null });
    }
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ baseline: result.baseline });
}
