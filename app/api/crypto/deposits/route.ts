import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { CryptoDeposit } from "@/lib/utils/types";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
);

function toCamel(r: Record<string, unknown>): CryptoDeposit {
  return {
    id: r.id as string,
    date: r.date as string,
    token: r.token as string,
    amount: Number(r.amount),
    usdValueAtDeposit: Number(r.usd_value_at_deposit),
    kind: r.kind as "stablecoin" | "crypto",
    notes: (r.notes as string | null) ?? undefined,
    createdAt: new Date(r.created_at as string).getTime(),
  };
}

export async function GET() {
  const { data, error } = await supabase
    .from("crypto_deposits")
    .select("*")
    .order("date", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const deposits = (data ?? []).map(toCamel);
  return NextResponse.json({ deposits });
}

export async function POST(req: Request) {
  const body = await req.json() as Partial<CryptoDeposit>;
  if (!body.token || body.amount == null || body.usdValueAtDeposit == null || !body.kind) {
    return NextResponse.json({ error: "token, amount, usdValueAtDeposit, kind required" }, { status: 400 });
  }
  const row = {
    date: body.date ?? new Date().toISOString(),
    token: body.token,
    amount: body.amount,
    usd_value_at_deposit: body.usdValueAtDeposit,
    kind: body.kind,
    notes: body.notes ?? null,
  };
  const { data, error } = await supabase
    .from("crypto_deposits")
    .insert(row)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deposit: toCamel(data) });
}
