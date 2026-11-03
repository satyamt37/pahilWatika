"use client";
import { ArrowDownCircle, ArrowUpCircle, IndianRupee, Lock, Wallet } from "lucide-react";
import Link from "next/link";
import { Card, LinkButton, SectionTitle, Skeleton } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { todayISO } from "@/lib/dates";
import { summarise, type DueRow } from "@/lib/finance";
import { money } from "@/lib/format";
import { useLoad } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import type { LedgerRow } from "@/lib/types";

/** Load the full ledger (paged, so it is never silently truncated at the API row limit). */
export async function loadLedger(): Promise<LedgerRow[]> {
  const out: LedgerRow[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase
      .from("fin_ledger")
      .select("*")
      .order("txn_date", { ascending: false })
      .order("txn_no", { ascending: false })
      .range(from, from + page - 1);
    if (error) throw error;
    for (const r of data ?? []) out.push({ ...r, amount: Number(r.amount), signed_amount: Number(r.signed_amount) } as LedgerRow);
    if (!data || data.length < page) break;
  }
  return out;
}

export async function loadDues(from: string, to: string): Promise<DueRow[]> {
  const { data, error } = await supabase.rpc("fin_member_dues", { p_from: from, p_to: to });
  if (error) throw error;
  return ((data ?? []) as DueRow[]).map((d) => ({ ...d, expected: Number(d.expected), paid: Number(d.paid) }));
}

/** Homepage card: this month's collection/expenditure and the available balance. */
export default function FinanceSummary() {
  const a = useAuth();
  if (a.loading) return null;
  if (!a.user) {
    return (
      <Card className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gold-100 text-gold-700"><Lock className="h-5 w-5" /></span>
          <div>
            <p className="font-hindi font-semibold text-forest">हिसाब-किताब सदस्यों के लिए</p>
            <p className="text-sm text-muted">Hisaab-Kitab is visible to signed-in members.</p>
          </div>
        </div>
        <LinkButton href="/login/?next=/hisaab/" variant="secondary" size="sm">लॉगिन · Sign in</LinkButton>
      </Card>
    );
  }
  if (!a.canSeeFinance) return null;
  return <SummaryInner />;
}

function SummaryInner() {
  const { data, loading, error } = useLoad(loadLedger, []);
  const s = data ? summarise(data, todayISO()) : null;
  const monthName = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date());
  return (
    <div>
      <SectionTitle hi="इस माह का हिसाब-किताब" en={`Monthly summary · ${monthName}`} action={<Link href="/hisaab/" className="text-sm font-medium text-leaf-700 hover:underline">पूरा देखें →</Link>} />
      {error ? (
        <Card className="p-4 text-sm text-red-700">{error}</Card>
      ) : loading || !s ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20" />)}</div>
      ) : s.count === 0 ? (
        <Card className="flex items-center gap-3 p-5 text-sm text-muted">
          <IndianRupee className="h-5 w-5 text-leaf" /> अभी कोई लेन-देन दर्ज नहीं है · No transactions recorded yet.
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Tile icon={<ArrowDownCircle className="h-5 w-5" />} tone="bg-leaf-50 text-leaf-700" hi="इस माह जमा" en="Collected this month" value={money(s.thisMonth.collection)} />
          <Tile icon={<ArrowUpCircle className="h-5 w-5" />} tone="bg-red-50 text-red-700" hi="इस माह खर्च" en="Spent this month" value={money(s.thisMonth.expenditure)} />
          <Tile icon={<Wallet className="h-5 w-5" />} tone="bg-gold-100 text-gold-700" hi="उपलब्ध शेष" en="Available balance" value={money(s.balance)} strong />
        </div>
      )}
    </div>
  );
}

function Tile({ icon, tone, hi, en, value, strong }: { icon: React.ReactNode; tone: string; hi: string; en: string; value: string; strong?: boolean }) {
  return (
    <Link href="/hisaab/">
      <Card className={`flex items-center gap-3 p-4 transition-shadow hover:shadow-lift ${strong ? "ring-1 ring-gold/50" : ""}`}>
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${tone}`}>{icon}</span>
        <div className="min-w-0">
          <p className="font-hindi text-sm text-muted">{hi} <span className="text-xs">· {en}</span></p>
          <p className="truncate text-xl font-bold text-forest">{value}</p>
        </div>
      </Card>
    </Link>
  );
}
