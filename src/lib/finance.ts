// Pure finance calculations. Every figure is derived from ledger rows'
// signed amounts (credits +, debits −, reversals flip the sign), so totals
// always reconcile with the authoritative transaction records.
import type { LedgerRow, TxnKind } from "./types.ts";

export type LedgerLike = Pick<LedgerRow, "kind" | "amount" | "txn_date" | "is_reversal"> &
  Partial<Pick<LedgerRow, "signed_amount" | "member_id" | "member_name" | "category" | "period_month">>;

export interface Flow {
  collection: number;
  expenditure: number;
  net: number;
}

export interface Summary {
  collection: number;
  expenditure: number;
  balance: number;
  openingBalance: number;
  count: number;
  thisMonth: Flow;
  prevMonth: Flow;
  thisYear: Flow;
  prevYear: Flow;
}

export const KIND_LABELS: Record<TxnKind, { hi: string; en: string }> = {
  contribution: { hi: "अंशदान", en: "Contribution" },
  other_income: { hi: "अन्य आय", en: "Other income" },
  expense: { hi: "खर्च", en: "Expense" },
  opening_balance: { hi: "प्रारंभिक शेष", en: "Opening balance" },
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Signed amount of a row, computed the same way as the database's fin_signed(). */
export function signedAmount(r: LedgerLike): number {
  if (typeof r.signed_amount === "number" || typeof r.signed_amount === "string") return Number(r.signed_amount);
  const a = Number(r.amount);
  return a * (r.kind === "expense" ? -1 : 1) * (r.is_reversal ? -1 : 1);
}

const emptyFlow = (): Flow => ({ collection: 0, expenditure: 0, net: 0 });

function addTo(f: Flow, r: LedgerLike) {
  const s = signedAmount(r);
  if (r.kind === "expense") f.expenditure += -s;
  else if (r.kind !== "opening_balance") f.collection += s;
  f.net += s;
}

function roundFlow(f: Flow): Flow {
  return { collection: round2(f.collection), expenditure: round2(f.expenditure), net: round2(f.net) };
}

/** "2026-11" for the month containing an ISO date. */
export const monthKey = (iso: string) => iso.slice(0, 7);

export function prevMonthKey(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** Totals for the whole ledger plus this/previous month and year (relative to `today`, YYYY-MM-DD). */
export function summarise(rows: LedgerLike[], today: string): Summary {
  const all = emptyFlow();
  const tm = emptyFlow();
  const pm = emptyFlow();
  const ty = emptyFlow();
  const py = emptyFlow();
  let opening = 0;
  const thisM = monthKey(today);
  const prevM = prevMonthKey(thisM);
  const thisY = today.slice(0, 4);
  const prevY = String(Number(thisY) - 1);
  for (const r of rows) {
    addTo(all, r);
    if (r.kind === "opening_balance") opening += signedAmount(r);
    const mk = monthKey(r.txn_date);
    if (mk === thisM) addTo(tm, r);
    if (mk === prevM) addTo(pm, r);
    const yk = r.txn_date.slice(0, 4);
    if (yk === thisY) addTo(ty, r);
    if (yk === prevY) addTo(py, r);
  }
  return {
    collection: round2(all.collection),
    expenditure: round2(all.expenditure),
    balance: round2(all.net),
    openingBalance: round2(opening),
    count: rows.length,
    thisMonth: roundFlow(tm),
    prevMonth: roundFlow(pm),
    thisYear: roundFlow(ty),
    prevYear: roundFlow(py),
  };
}

export interface MonthPoint extends Flow {
  month: string; // YYYY-MM
  label: string; // "Nov 26"
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthLabel = (key: string) => {
  const [y, m] = key.split("-");
  return `${SHORT_MONTHS[Number(m) - 1]} ${y.slice(2)}`;
};

/** Continuous monthly series ending at `today`'s month, `months` long (missing months are zero). */
export function monthlySeries(rows: LedgerLike[], today: string, months = 12): MonthPoint[] {
  const keys: string[] = [];
  let k = monthKey(today);
  for (let i = 0; i < months; i++) {
    keys.unshift(k);
    k = prevMonthKey(k);
  }
  const map = new Map(keys.map((key) => [key, emptyFlow()]));
  for (const r of rows) {
    const f = map.get(monthKey(r.txn_date));
    if (f) addTo(f, r);
  }
  return keys.map((key) => ({ month: key, label: monthLabel(key), ...roundFlow(map.get(key)!) }));
}

/** Per-month totals over every month that has entries (newest first) — for monthly reports. */
export function monthlyTotals(rows: LedgerLike[]): MonthPoint[] {
  const map = new Map<string, Flow>();
  for (const r of rows) {
    const key = monthKey(r.txn_date);
    if (!map.has(key)) map.set(key, emptyFlow());
    addTo(map.get(key)!, r);
  }
  return [...map.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, f]) => ({ month: key, label: monthLabel(key), ...roundFlow(f) }));
}

export interface YearTotal extends Flow {
  year: string;
}

export function yearlyTotals(rows: LedgerLike[]): YearTotal[] {
  const map = new Map<string, Flow>();
  for (const r of rows) {
    const y = r.txn_date.slice(0, 4);
    if (!map.has(y)) map.set(y, emptyFlow());
    addTo(map.get(y)!, r);
  }
  return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([year, f]) => ({ year, ...roundFlow(f) }));
}

export interface MemberTotal {
  member_id: string;
  member_name: string;
  total: number;
  entries: number;
  lastDate: string | null;
}

/** Contribution totals per member (net of reversals), highest first. */
export function memberTotals(rows: LedgerLike[]): MemberTotal[] {
  const map = new Map<string, MemberTotal>();
  for (const r of rows) {
    if (r.kind !== "contribution" || !r.member_id) continue;
    const cur = map.get(r.member_id) ?? { member_id: r.member_id, member_name: r.member_name ?? "—", total: 0, entries: 0, lastDate: null };
    cur.total += signedAmount(r);
    if (!r.is_reversal) {
      cur.entries += 1;
      if (!cur.lastDate || r.txn_date > cur.lastDate) cur.lastDate = r.txn_date;
    } else {
      cur.entries -= 1;
    }
    map.set(r.member_id, cur);
  }
  return [...map.values()].map((m) => ({ ...m, total: round2(m.total) })).sort((a, b) => b.total - a.total || a.member_name.localeCompare(b.member_name));
}

/** Expense totals per category (net of reversals). */
export function categoryTotals(rows: LedgerLike[], kind: "expense" | "income" = "expense"): { category: string; total: number }[] {
  const map = new Map<string, number>();
  for (const r of rows) {
    const isExp = r.kind === "expense";
    if ((kind === "expense") !== isExp || r.kind === "opening_balance") continue;
    const c = r.category || "Uncategorised";
    const s = signedAmount(r);
    map.set(c, (map.get(c) ?? 0) + (isExp ? -s : s));
  }
  return [...map.entries()].map(([category, total]) => ({ category, total: round2(total) })).sort((a, b) => b.total - a.total);
}

export interface DueRow {
  member_id: string;
  member_name: string;
  period_month: string;
  expected: number;
  paid: number;
  status: "paid" | "partial" | "pending";
}

/** Outstanding per member from fin_member_dues rows. */
export function outstanding(dues: DueRow[]): { member_id: string; member_name: string; expected: number; paid: number; due: number; months: number }[] {
  const map = new Map<string, { member_id: string; member_name: string; expected: number; paid: number; due: number; months: number }>();
  for (const d of dues) {
    const cur = map.get(d.member_id) ?? { member_id: d.member_id, member_name: d.member_name, expected: 0, paid: 0, due: 0, months: 0 };
    const exp = Number(d.expected);
    const paid = Number(d.paid);
    cur.expected += exp;
    cur.paid += paid;
    const gap = Math.max(0, exp - paid);
    cur.due += gap;
    if (gap > 0) cur.months += 1;
    map.set(d.member_id, cur);
  }
  return [...map.values()]
    .map((m) => ({ ...m, expected: round2(m.expected), paid: round2(m.paid), due: round2(m.due) }))
    .sort((a, b) => b.due - a.due || a.member_name.localeCompare(b.member_name));
}

export const totalPending = (dues: DueRow[]) => round2(outstanding(dues).reduce((s, m) => s + m.due, 0));

/** Percentage change, or null when the previous value is zero. */
export function pctChange(cur: number, prev: number): number | null {
  if (!prev) return null;
  return Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10;
}

// ---------------------------------------------------------------------------- import mapping
/** Classify a Salesforce/Excel "type" cell into a transaction kind. */
export function classifyKind(v: unknown, fallbackSign?: number): TxnKind | null {
  const s = String(v ?? "").trim().toLowerCase();
  if (s) {
    if (/opening|प्रारंभ/.test(s)) return "opening_balance";
    if (/debit|expense|expenditure|spent|paid out|खर्च|व्यय|डेबिट|नामे/.test(s)) return "expense";
    if (/contribution|chanda|चंदा|अंशदान|monthly|मासिक/.test(s)) return "contribution";
    if (/credit|income|received|deposit|collection|जमा|आय|क्रेडिट/.test(s)) return "contribution";
  }
  if (fallbackSign !== undefined && fallbackSign !== 0) return fallbackSign < 0 ? "expense" : "contribution";
  return null;
}

/** Duplicate key for imported rows vs existing ledger rows. */
export function dupeKey(r: { txn_date: string; amount: number | string; member_id?: string | null; title?: string | null; kind: string }): string {
  return [r.txn_date, Number(r.amount).toFixed(2), r.kind === "expense" ? "d" : "c", r.member_id ?? "", (r.title ?? "").trim().toLowerCase()].join("|");
}
