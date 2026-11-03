"use client";
import {
  ArrowDownCircle, ArrowUpCircle, ExternalLink, FileSpreadsheet, FileText, Hourglass, IndianRupee, Search, Settings2, TrendingDown, TrendingUp, Wallet,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { loadDues, loadLedger } from "@/components/finance/FinanceSummary";
import { KindBadge, TxnDetails } from "@/components/finance/TxnParts";
import { Guard } from "@/components/Guard";
import { useToast } from "@/components/toast";
import {
  Button, Card, EmptyState, ErrorState, Input, LinkButton, Loading, PageHeader, SectionTitle, Select, StatCard, Tabs,
} from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { formatDate, todayISO } from "@/lib/dates";
import {
  categoryTotals, KIND_LABELS, memberTotals, monthLabel, monthlySeries, monthlyTotals, outstanding, pctChange, summarise, totalPending, type DueRow,
} from "@/lib/finance";
import { exportPdf, exportXlsx, pdfMoney, summaryPairs, type ReportSpec } from "@/lib/financeExport";
import { clsx, money } from "@/lib/format";
import { useLoad } from "@/lib/hooks";
import { signedUrl } from "@/lib/storage";
import type { LedgerRow, TxnKind } from "@/lib/types";

type Tab = "overview" | "transactions" | "members" | "reports";

export default function HisaabPage() {
  return (
    <Guard need="finance">
      <HisaabInner />
    </Guard>
  );
}

function HisaabInner() {
  const a = useAuth();
  const today = todayISO();
  const year = today.slice(0, 4);
  const ledger = useLoad(loadLedger, []);
  const dues = useLoad(() => loadDues(`${year}-01-01`, today), [year, today]);
  const [tab, setTab] = useState<Tab>("overview");

  return (
    <div>
      <PageHeader hi="हिसाब-किताब" en="Hisaab-Kitab · transparent community accounts">
        {a.isTreasurer && <LinkButton href="/admin/?tab=finance" variant="gold" size="sm" icon={<Settings2 className="h-4 w-4" />}>प्रविष्टि जोड़ें · Manage</LinkButton>}
      </PageHeader>

      <LegacyCard />

      <Tabs<Tab>
        className="mb-5 mt-5"
        value={tab}
        onChange={setTab}
        items={[
          { value: "overview", label: "सारांश · Overview" },
          { value: "transactions", label: "लेन-देन · Transactions" },
          { value: "members", label: "सदस्यवार · Member-wise" },
          { value: "reports", label: "रिपोर्ट · Reports" },
        ]}
      />

      {ledger.error ? (
        <ErrorState message={ledger.error} onRetry={ledger.reload} />
      ) : ledger.loading || !ledger.data ? (
        <Loading />
      ) : (
        <>
          {tab === "overview" && <Overview rows={ledger.data} dues={dues.data ?? []} duesLoading={dues.loading} today={today} />}
          {tab === "transactions" && <Transactions rows={ledger.data} />}
          {tab === "members" && <MemberWise rows={ledger.data} today={today} />}
          {tab === "reports" && <Reports rows={ledger.data} today={today} />}
        </>
      )}
    </div>
  );
}

function LegacyCard() {
  const { hisaab } = useAuth();
  if (!hisaab.legacy_url) return null;
  return (
    <Card className="flex flex-col gap-3 border-gold/30 bg-gold-100/40 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-sm">
        <p className="font-semibold text-forest">पुराना हिसाब-किताब · {hisaab.legacy_name}</p>
        <p className="text-muted">
          Historical records stay in the existing Salesforce app until the owner approves migrating them here. Nothing has been moved or changed there.
        </p>
      </div>
      <LinkButton href={hisaab.legacy_url} external variant="secondary" size="sm" icon={<ExternalLink className="h-4 w-4" />}>
        पुराना ऐप खोलें · Open
      </LinkButton>
    </Card>
  );
}

// ------------------------------------------------------------------ overview
function Overview({ rows, dues, duesLoading, today }: { rows: LedgerRow[]; dues: DueRow[]; duesLoading: boolean; today: string }) {
  const s = useMemo(() => summarise(rows, today), [rows, today]);
  const series = useMemo(() => monthlySeries(rows, today, 12), [rows, today]);
  const pending = totalPending(dues);

  if (!rows.length) {
    return (
      <EmptyState
        icon={<IndianRupee className="h-7 w-7" />}
        title="अभी कोई लेन-देन नहीं"
        text="No transactions have been recorded in this ledger yet. Figures will appear here as soon as the treasurer adds entries."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="कुल जमा · Total collection" value={money(s.collection)} icon={<ArrowDownCircle className="h-5 w-5" />} />
        <StatCard label="कुल खर्च · Total expenditure" value={money(s.expenditure)} icon={<ArrowUpCircle className="h-5 w-5" />} tone="red" />
        <StatCard label="उपलब्ध शेष · Balance" value={money(s.balance)} icon={<Wallet className="h-5 w-5" />} tone="gold"
          sub={s.openingBalance ? `incl. opening ${money(s.openingBalance)}` : undefined} />
        <StatCard label="बकाया · Pending" value={duesLoading ? "…" : money(pending)} icon={<Hourglass className="h-5 w-5" />} tone="forest"
          sub={`Contributions due in ${today.slice(0, 4)}`} />
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Compare title="इस माह · This month" cur={s.thisMonth} prev={s.prevMonth} prevLabel="vs last month" />
        <PeriodCard title="पिछला माह · Last month" f={s.prevMonth} />
        <PeriodCard title={`वर्ष ${today.slice(0, 4)} · This year`} f={s.thisYear} />
      </div>

      <Card className="p-4 sm:p-5">
        <SectionTitle hi="आय बनाम व्यय" en="Income vs expense · last 12 months" />
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={series} margin={{ top: 4, right: 4, left: -8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#EFEADB" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#737B76" }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 11, fill: "#737B76" }} width={56}
                tickFormatter={(v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 100) / 10}k` : String(v))} />
              <Tooltip formatter={(v: number) => money(v)} contentStyle={{ borderRadius: 12, border: "1px solid #EFEADB" }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="collection" name="जमा · Income" fill="#4C956C" radius={[6, 6, 0, 0]} />
              <Bar dataKey="expenditure" name="खर्च · Expense" fill="#E6B85C" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <ExpenseBreakdown rows={rows} />
    </div>
  );
}

function Compare({ title, cur, prev, prevLabel }: { title: string; cur: { collection: number; expenditure: number; net: number }; prev: { collection: number; expenditure: number }; prevLabel: string }) {
  const c = pctChange(cur.collection, prev.collection);
  const e = pctChange(cur.expenditure, prev.expenditure);
  return (
    <Card className="p-4">
      <p className="font-hindi text-sm font-semibold text-forest">{title}</p>
      <div className="mt-2 space-y-1.5 text-sm">
        <Line label="जमा · In" value={money(cur.collection)} delta={c} prevLabel={prevLabel} good="up" />
        <Line label="खर्च · Out" value={money(cur.expenditure)} delta={e} prevLabel={prevLabel} good="down" />
        <div className="flex justify-between border-t border-forest/10 pt-1.5 font-semibold"><span>शुद्ध · Net</span><span>{money(cur.net)}</span></div>
      </div>
    </Card>
  );
}

function Line({ label, value, delta, prevLabel, good }: { label: string; value: string; delta: number | null; prevLabel: string; good: "up" | "down" }) {
  const positive = delta !== null && delta > 0;
  const isGood = delta === null || delta === 0 ? null : (positive ? good === "up" : good === "down");
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted">{label}</span>
      <span className="flex items-center gap-2">
        <span className="font-medium text-forest">{value}</span>
        {delta !== null && (
          <span className={clsx("inline-flex items-center gap-0.5 text-xs", isGood ? "text-leaf-700" : "text-red-600")} title={prevLabel}>
            {positive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {Math.abs(delta)}%
          </span>
        )}
      </span>
    </div>
  );
}

function PeriodCard({ title, f }: { title: string; f: { collection: number; expenditure: number; net: number } }) {
  return (
    <Card className="p-4">
      <p className="font-hindi text-sm font-semibold text-forest">{title}</p>
      <div className="mt-2 space-y-1.5 text-sm">
        <div className="flex justify-between"><span className="text-muted">जमा · In</span><span className="font-medium">{money(f.collection)}</span></div>
        <div className="flex justify-between"><span className="text-muted">खर्च · Out</span><span className="font-medium">{money(f.expenditure)}</span></div>
        <div className="flex justify-between border-t border-forest/10 pt-1.5 font-semibold"><span>शुद्ध · Net</span><span>{money(f.net)}</span></div>
      </div>
    </Card>
  );
}

function ExpenseBreakdown({ rows }: { rows: LedgerRow[] }) {
  const cats = categoryTotals(rows).filter((c) => c.total > 0);
  if (!cats.length) return null;
  const max = cats[0].total;
  return (
    <Card className="p-4 sm:p-5">
      <SectionTitle hi="खर्च का विवरण" en="Expenses by category (all time)" />
      <ul className="space-y-2.5">
        {cats.map((c) => (
          <li key={c.category}>
            <div className="mb-1 flex justify-between text-sm"><span className="text-forest">{c.category}</span><span className="font-medium">{money(c.total)}</span></div>
            <div className="h-2 rounded-full bg-cream-200"><div className="h-2 rounded-full bg-gold" style={{ width: `${(c.total / max) * 100}%` }} /></div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ------------------------------------------------------------------ transactions
async function openReceipt(path: string, onErr: (e: unknown) => void) {
  const url = await signedUrl("receipts", path);
  if (url) window.open(url, "_blank", "noopener");
  else onErr("Receipt could not be opened");
}

function Transactions({ rows }: { rows: LedgerRow[] }) {
  const toast = useToast();
  const [month, setMonth] = useState("");
  const [kind, setKind] = useState<"" | TxnKind>("");
  const [member, setMember] = useState("");
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(50);

  const members = useMemo(() => {
    const m = new Map<string, string>();
    rows.forEach((r) => r.member_id && m.set(r.member_id, r.member_name ?? "—"));
    return [...m.entries()].sort((x, y) => x[1].localeCompare(y[1]));
  }, [rows]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) =>
      (!month || r.txn_date.startsWith(month)) &&
      (!kind || r.kind === kind) &&
      (!member || r.member_id === member) &&
      (!s || [r.title, r.description, r.remarks, r.category, r.member_name, r.reference_no, r.paid_by, String(r.txn_no)]
        .some((v) => v?.toLowerCase().includes(s))),
    );
  }, [rows, month, kind, member, q]);
  const net = filtered.reduce((t, r) => t + Number(r.signed_amount), 0);

  return (
    <div className="space-y-4">
      <Card className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted" />
          <Input className="pl-9" placeholder="खोजें · Search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search transactions" />
        </div>
        <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month" />
        <Select value={kind} onChange={(e) => setKind(e.target.value as TxnKind | "")} aria-label="Type">
          <option value="">सभी प्रकार · All types</option>
          {(Object.keys(KIND_LABELS) as TxnKind[]).map((k) => <option key={k} value={k}>{KIND_LABELS[k].hi} · {KIND_LABELS[k].en}</option>)}
        </Select>
        <Select value={member} onChange={(e) => setMember(e.target.value)} aria-label="Member">
          <option value="">सभी सदस्य · All members</option>
          {members.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </Select>
      </Card>

      <p className="text-sm text-muted">{filtered.length} entries · net {money(net)}</p>

      {!filtered.length ? (
        <EmptyState title="कोई प्रविष्टि नहीं मिली" text={rows.length ? "No entries match these filters." : "No transactions recorded yet."} />
      ) : (
        <>
          {/* Desktop table */}
          <Card className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead className="bg-cream-100 text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2.5">#</th><th className="px-3 py-2.5">Date</th><th className="px-3 py-2.5">Type</th>
                  <th className="px-3 py-2.5">Details</th><th className="px-3 py-2.5">Method</th><th className="px-3 py-2.5 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, limit).map((r) => (
                  <tr key={r.id} className={clsx("border-t border-forest/5 align-top", (r.is_reversed || r.is_reversal) && "bg-cream-100/60")}>
                    <td className="px-3 py-2.5 text-muted">{r.txn_no}</td>
                    <td className="whitespace-nowrap px-3 py-2.5">{formatDate(r.txn_date, { day: "numeric", month: "short", year: "numeric" })}</td>
                    <td className="px-3 py-2.5"><KindBadge kind={r.kind} /></td>
                    <td className="px-3 py-2.5">
                      <TxnDetails r={r} onReceipt={(p) => openReceipt(p, toast.error)} />
                    </td>
                    <td className="px-3 py-2.5 text-muted">{r.payment_method ?? ""}{r.reference_no ? ` · ${r.reference_no}` : ""}</td>
                    <td className={clsx("whitespace-nowrap px-3 py-2.5 text-right font-semibold", r.signed_amount < 0 ? "text-red-700" : "text-leaf-700", r.is_reversed && "line-through opacity-60")}>
                      {r.signed_amount < 0 ? "−" : "+"}{money(Math.abs(r.signed_amount))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          {/* Mobile cards */}
          <div className="space-y-2.5 md:hidden">
            {filtered.slice(0, limit).map((r) => (
              <Card key={r.id} className="p-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <TxnDetails r={r} onReceipt={(p) => openReceipt(p, toast.error)} />
                    <p className="mt-1 text-xs text-muted">#{r.txn_no} · {formatDate(r.txn_date)}{r.payment_method ? ` · ${r.payment_method}` : ""}</p>
                  </div>
                  <span className={clsx("shrink-0 font-semibold", r.signed_amount < 0 ? "text-red-700" : "text-leaf-700", r.is_reversed && "line-through opacity-60")}>
                    {r.signed_amount < 0 ? "−" : "+"}{money(Math.abs(r.signed_amount))}
                  </span>
                </div>
              </Card>
            ))}
          </div>
          {filtered.length > limit && (
            <div className="text-center"><Button variant="secondary" onClick={() => setLimit((l) => l + 50)}>और दिखाएँ · Show more</Button></div>
          )}
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ member-wise
function MemberWise({ rows, today }: { rows: LedgerRow[]; today: string }) {
  const thisYear = Number(today.slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const to = year === thisYear ? today : `${year}-12-31`;
  const dues = useLoad(() => loadDues(`${year}-01-01`, to), [year, to]);
  const totals = useMemo(() => memberTotals(rows.filter((r) => r.txn_date.startsWith(String(year)))), [rows, year]);
  const years = useMemo(() => {
    const ys = new Set<number>([thisYear]);
    rows.forEach((r) => ys.add(Number(r.txn_date.slice(0, 4))));
    return [...ys].sort((a, b) => b - a);
  }, [rows, thisYear]);

  const grid = useMemo(() => {
    const months = [...new Set((dues.data ?? []).map((d) => d.period_month.slice(0, 7)))].sort();
    const byMember = new Map<string, { name: string; cells: Map<string, DueRow> }>();
    for (const d of dues.data ?? []) {
      const m = byMember.get(d.member_id) ?? { name: d.member_name, cells: new Map() };
      m.cells.set(d.period_month.slice(0, 7), d);
      byMember.set(d.member_id, m);
    }
    return { months, members: [...byMember.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name)) };
  }, [dues.data]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted">वर्ष · Year</span>
        <Select className="w-32" value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Year">
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </Select>
      </div>

      <Card className="p-4 sm:p-5">
        <SectionTitle hi="मासिक अंशदान स्थिति" en="Monthly contribution status (from contribution rules)" />
        {dues.error ? (
          <ErrorState message={dues.error} onRetry={dues.reload} />
        ) : dues.loading ? (
          <Loading />
        ) : !grid.members.length ? (
          <p className="text-sm text-muted">No monthly contribution rule applies to {year}. The treasurer can configure the amount under Admin → Hisaab-Kitab → Rules.</p>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap gap-3 text-xs">
              <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-leaf" /> जमा · Paid</span>
              <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-gold" /> आंशिक · Partial</span>
              <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-red-200" /> बकाया · Pending</span>
            </div>
            <div className="overflow-x-auto">
              <table className="text-sm">
                <thead>
                  <tr>
                    <th className="sticky left-0 bg-white px-2 py-1.5 text-left font-medium text-muted">सदस्य · Member</th>
                    {grid.months.map((m) => <th key={m} className="px-1 py-1.5 text-xs font-medium text-muted">{monthLabel(m).split(" ")[0]}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {grid.members.map(([id, m]) => (
                    <tr key={id} className="border-t border-forest/5">
                      <td className="sticky left-0 max-w-[10rem] truncate bg-white px-2 py-1.5 text-forest">{m.name}</td>
                      {grid.months.map((mo) => {
                        const d = m.cells.get(mo);
                        if (!d) return <td key={mo} className="px-1 py-1.5"><span className="block h-7 w-9 rounded bg-cream-100" title="Not applicable" /></td>;
                        const cls = d.status === "paid" ? "bg-leaf text-white" : d.status === "partial" ? "bg-gold text-forest-900" : "bg-red-100 text-red-700";
                        return (
                          <td key={mo} className="px-1 py-1.5">
                            <span className={clsx("flex h-7 w-9 items-center justify-center rounded text-[10px] font-semibold", cls)} title={`${monthLabel(mo)}: paid ${money(d.paid)} of ${money(d.expected)}`}>
                              {d.status === "paid" ? "✓" : d.status === "partial" ? "½" : "–"}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      <Card className="p-4 sm:p-5">
        <SectionTitle hi="सदस्यवार कुल अंशदान" en={`Total contributions per member · ${year}`} />
        {!totals.length ? (
          <p className="text-sm text-muted">No contributions recorded in {year}.</p>
        ) : (
          <ul className="divide-y divide-forest/5">
            {totals.map((m) => (
              <li key={m.member_id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium text-forest">{m.member_name}</p>
                  <p className="text-xs text-muted">{m.entries} entries{m.lastDate ? ` · last ${formatDate(m.lastDate)}` : ""}</p>
                </div>
                <span className="font-semibold text-leaf-700">{money(m.total)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ reports
type ReportKind = "monthly" | "annual" | "member" | "expense" | "collection" | "outstanding";
const REPORTS: { key: ReportKind; hi: string; en: string; period: "month" | "year" }[] = [
  { key: "monthly", hi: "मासिक रिपोर्ट", en: "Monthly report", period: "month" },
  { key: "annual", hi: "वार्षिक रिपोर्ट", en: "Annual report", period: "year" },
  { key: "member", hi: "सदस्यवार रिपोर्ट", en: "Member-wise report", period: "year" },
  { key: "expense", hi: "खर्च रिपोर्ट", en: "Expense report", period: "year" },
  { key: "collection", hi: "जमा रिपोर्ट", en: "Collection report", period: "year" },
  { key: "outstanding", hi: "बकाया रिपोर्ट", en: "Outstanding report", period: "year" },
];

const txnRow = (r: LedgerRow) => [
  r.txn_no,
  r.txn_date,
  KIND_LABELS[r.kind].en + (r.is_reversal ? " (reversal)" : r.is_reversed ? " (reversed)" : ""),
  r.kind === "contribution" ? r.member_name ?? "" : r.title ?? "",
  r.category ?? "",
  [r.description, r.remarks].filter(Boolean).join(" · "),
  r.payment_method ?? "",
  r.reference_no ?? "",
  pdfMoney(r.signed_amount),
];
const TXN_COLS = ["#", "Date", "Type", "Member / Item", "Category", "Details", "Method", "Ref", "Amount"];

async function buildReport(kind: ReportKind, rows: LedgerRow[], period: string, today: string): Promise<ReportSpec> {
  const inPeriod = rows.filter((r) => r.txn_date.startsWith(period));
  const s = summarise(inPeriod, today);
  const base = `pahil-vatika-${kind}-${period}`;
  switch (kind) {
    case "monthly":
      return { title: `Monthly report ${monthLabel(period)}`, filename: base, summary: summaryPairs(s), columns: TXN_COLS, rows: inPeriod.map(txnRow), moneyCols: [8] };
    case "annual": {
      const months = monthlyTotals(inPeriod).reverse();
      return {
        title: `Annual report ${period}`, filename: base, summary: summaryPairs(s),
        columns: ["Month", "Collection", "Expenditure", "Net"],
        rows: months.map((m) => [m.label, pdfMoney(m.collection), pdfMoney(m.expenditure), pdfMoney(m.net)]), moneyCols: [1, 2, 3],
      };
    }
    case "member": {
      const t = memberTotals(inPeriod);
      return {
        title: `Member-wise contributions ${period}`, filename: base,
        summary: [["Total contributions", pdfMoney(t.reduce((a, m) => a + m.total, 0))], ["Members", String(t.length)]],
        columns: ["Member", "Entries", "Last payment", "Total"],
        rows: t.map((m) => [m.member_name, m.entries, m.lastDate ?? "", pdfMoney(m.total)]), moneyCols: [3],
      };
    }
    case "expense": {
      const ex = inPeriod.filter((r) => r.kind === "expense");
      return {
        title: `Expense report ${period}`, filename: base,
        summary: [["Total expenditure", pdfMoney(s.expenditure)], ...categoryTotals(ex).map((c) => [c.category, pdfMoney(c.total)] as [string, string])],
        columns: ["#", "Date", "Item", "Category", "Paid by", "Details", "Amount"],
        rows: ex.map((r) => [r.txn_no, r.txn_date, r.title ?? "", r.category ?? "", r.paid_by ?? "", [r.description, r.remarks].filter(Boolean).join(" · "), pdfMoney(-r.signed_amount)]),
        moneyCols: [6],
      };
    }
    case "collection": {
      const cr = inPeriod.filter((r) => r.kind === "contribution" || r.kind === "other_income");
      return {
        title: `Collection report ${period}`, filename: base, summary: [["Total collection", pdfMoney(s.collection)]],
        columns: ["#", "Date", "Type", "Member / Source", "For month", "Method", "Ref", "Amount"],
        rows: cr.map((r) => [r.txn_no, r.txn_date, KIND_LABELS[r.kind].en + (r.is_reversal ? " (reversal)" : ""), r.member_name ?? r.title ?? "", r.period_month?.slice(0, 7) ?? "", r.payment_method ?? "", r.reference_no ?? "", pdfMoney(r.signed_amount)]),
        moneyCols: [7],
      };
    }
    case "outstanding": {
      const to = period === today.slice(0, 4) ? today : `${period}-12-31`;
      const o = outstanding(await loadDues(`${period}-01-01`, to)).filter((m) => m.due > 0);
      return {
        title: `Outstanding contributions ${period}`, filename: base,
        summary: [["Total pending", pdfMoney(o.reduce((a, m) => a + m.due, 0))], ["Members with dues", String(o.length)]],
        columns: ["Member", "Months pending", "Expected", "Paid", "Due"],
        rows: o.map((m) => [m.member_name, m.months, pdfMoney(m.expected), pdfMoney(m.paid), pdfMoney(m.due)]), moneyCols: [2, 3, 4],
      };
    }
  }
}

function Reports({ rows, today }: { rows: LedgerRow[]; today: string }) {
  const toast = useToast();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [year, setYear] = useState(today.slice(0, 4));
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (kind: ReportKind, fmt: "pdf" | "xlsx", period: string) => {
    setBusy(`${kind}-${fmt}`);
    try {
      const spec = await buildReport(kind, rows, period, today);
      if (fmt === "pdf") await exportPdf(spec);
      else exportXlsx(spec);
      toast.success("रिपोर्ट डाउनलोड हो गई · Report downloaded");
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="grid grid-cols-2 gap-3 p-4 sm:max-w-md">
        <label className="text-sm"><span className="mb-1 block text-muted">माह · Month</span><Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></label>
        <label className="text-sm"><span className="mb-1 block text-muted">वर्ष · Year</span><Input type="number" min={2000} max={2100} value={year} onChange={(e) => setYear(e.target.value)} /></label>
      </Card>
      <div className="grid gap-3 sm:grid-cols-2">
        {REPORTS.map((r) => {
          const period = r.period === "month" ? month : year;
          return (
            <Card key={r.key} className="flex flex-col justify-between gap-3 p-4">
              <div>
                <p className="font-hindi font-semibold text-forest">{r.hi}</p>
                <p className="text-sm text-muted">{r.en} · {r.period === "month" ? (month ? monthLabel(month) : "—") : year}</p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" icon={<FileText className="h-4 w-4" />} loading={busy === `${r.key}-pdf`} disabled={!period} onClick={() => run(r.key, "pdf", period)}>PDF</Button>
                <Button size="sm" variant="secondary" icon={<FileSpreadsheet className="h-4 w-4" />} loading={busy === `${r.key}-xlsx`} disabled={!period} onClick={() => run(r.key, "xlsx", period)}>Excel</Button>
              </div>
            </Card>
          );
        })}
      </div>
      <p className="text-xs text-muted">All reports are calculated from the audited ledger; reversed entries are included together with their reversal so totals reconcile.</p>
    </div>
  );
}
