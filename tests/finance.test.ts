import assert from "node:assert/strict";
import { test } from "node:test";
import {
  categoryTotals, classifyKind, dupeKey, memberTotals, monthlySeries, outstanding, pctChange, prevMonthKey, signedAmount, summarise,
  type DueRow, type LedgerLike,
} from "../src/lib/finance.ts";

const row = (o: Partial<LedgerLike> & Pick<LedgerLike, "kind" | "amount" | "txn_date">): LedgerLike => ({ is_reversal: false, ...o });

test("signedAmount: credits positive, expenses negative, reversals flip", () => {
  assert.equal(signedAmount(row({ kind: "contribution", amount: 100, txn_date: "2026-01-01" })), 100);
  assert.equal(signedAmount(row({ kind: "expense", amount: 40, txn_date: "2026-01-01" })), -40);
  assert.equal(signedAmount(row({ kind: "contribution", amount: 100, txn_date: "2026-01-01", is_reversal: true })), -100);
  assert.equal(signedAmount(row({ kind: "expense", amount: 40, txn_date: "2026-01-01", is_reversal: true })), 40);
  // uses the DB-provided signed_amount when present
  assert.equal(signedAmount(row({ kind: "expense", amount: 40, txn_date: "2026-01-01", signed_amount: -40 })), -40);
});

test("summarise: totals, balance and reversal netting", () => {
  const rows: LedgerLike[] = [
    row({ kind: "opening_balance", amount: 1000, txn_date: "2025-12-31" }),
    row({ kind: "contribution", amount: 200, txn_date: "2026-11-02", member_id: "a" }),
    row({ kind: "contribution", amount: 200, txn_date: "2026-11-02", member_id: "b" }),
    row({ kind: "contribution", amount: 200, txn_date: "2026-11-03", member_id: "b", is_reversal: true }), // reversal of b
    row({ kind: "expense", amount: 150.5, txn_date: "2026-11-01" }),
    row({ kind: "other_income", amount: 50, txn_date: "2026-10-15" }),
    row({ kind: "expense", amount: 30, txn_date: "2026-10-20" }),
  ];
  const s = summarise(rows, "2026-11-03");
  assert.equal(s.collection, 250); // 200 + 200 - 200 + 50
  assert.equal(s.expenditure, 180.5);
  assert.equal(s.openingBalance, 1000);
  assert.equal(s.balance, 1000 + 250 - 180.5);
  assert.deepEqual(s.thisMonth, { collection: 200, expenditure: 150.5, net: 49.5 });
  assert.deepEqual(s.prevMonth, { collection: 50, expenditure: 30, net: 20 });
  assert.equal(s.thisYear.collection, 250);
  assert.equal(s.prevYear.net, 1000); // opening balance dated 2025 counts toward net, not collection
  assert.equal(s.prevYear.collection, 0);
});

test("summarise: January compares with previous December across the year boundary", () => {
  const rows = [
    row({ kind: "contribution", amount: 100, txn_date: "2026-12-31" }),
    row({ kind: "contribution", amount: 300, txn_date: "2027-01-01" }),
  ];
  const s = summarise(rows, "2027-01-15");
  assert.equal(s.thisMonth.collection, 300);
  assert.equal(s.prevMonth.collection, 100);
  assert.equal(s.thisYear.collection, 300);
  assert.equal(s.prevYear.collection, 100);
  assert.equal(prevMonthKey("2027-01"), "2026-12");
});

test("summarise: empty ledger is all zeros", () => {
  const s = summarise([], "2026-11-03");
  assert.equal(s.balance, 0);
  assert.equal(s.count, 0);
  assert.deepEqual(s.thisMonth, { collection: 0, expenditure: 0, net: 0 });
});

test("floating-point amounts are rounded to paise", () => {
  const rows = [0.1, 0.2].map((a) => row({ kind: "contribution", amount: a, txn_date: "2026-11-01" }));
  assert.equal(summarise(rows, "2026-11-03").collection, 0.3);
});

test("monthlySeries fills missing months with zero", () => {
  const series = monthlySeries([row({ kind: "expense", amount: 10, txn_date: "2026-09-05" })], "2026-11-03", 4);
  assert.deepEqual(series.map((p) => p.month), ["2026-08", "2026-09", "2026-10", "2026-11"]);
  assert.equal(series[1].expenditure, 10);
  assert.equal(series[0].expenditure, 0);
});

test("memberTotals nets reversals; categoryTotals nets reversed expenses", () => {
  const rows: LedgerLike[] = [
    row({ kind: "contribution", amount: 100, txn_date: "2026-11-01", member_id: "a", member_name: "A" }),
    row({ kind: "contribution", amount: 100, txn_date: "2026-11-02", member_id: "a", member_name: "A", is_reversal: true }),
    row({ kind: "contribution", amount: 50, txn_date: "2026-11-02", member_id: "b", member_name: "B" }),
    row({ kind: "expense", amount: 80, txn_date: "2026-11-02", category: "Chai" }),
    row({ kind: "expense", amount: 80, txn_date: "2026-11-03", category: "Chai", is_reversal: true }),
    row({ kind: "expense", amount: 20, txn_date: "2026-11-03", category: "Chai" }),
  ];
  const m = memberTotals(rows);
  assert.equal(m.find((x) => x.member_id === "a")!.total, 0);
  assert.equal(m[0].member_id, "b");
  assert.deepEqual(categoryTotals(rows), [{ category: "Chai", total: 20 }]);
});

test("outstanding sums only unpaid gaps", () => {
  const dues: DueRow[] = [
    { member_id: "a", member_name: "A", period_month: "2026-10-01", expected: 100, paid: 100, status: "paid" },
    { member_id: "a", member_name: "A", period_month: "2026-11-01", expected: 100, paid: 40, status: "partial" },
    { member_id: "b", member_name: "B", period_month: "2026-11-01", expected: 100, paid: 150, status: "paid" },
  ];
  const o = outstanding(dues);
  assert.equal(o[0].member_id, "a");
  assert.equal(o[0].due, 60);
  assert.equal(o[0].months, 1);
  assert.equal(o.find((x) => x.member_id === "b")!.due, 0); // overpayment is not negative due
});

test("classifyKind understands English and Hindi words and signs", () => {
  assert.equal(classifyKind("Debit"), "expense");
  assert.equal(classifyKind("Credit"), "contribution");
  assert.equal(classifyKind("खर्च"), "expense");
  assert.equal(classifyKind("जमा"), "contribution");
  assert.equal(classifyKind("", -5), "expense");
  assert.equal(classifyKind("", undefined), null);
});

test("dupeKey is stable for the same entry", () => {
  const a = dupeKey({ txn_date: "2026-11-01", amount: 100, member_id: "m", title: " Tea ", kind: "expense" });
  const b = dupeKey({ txn_date: "2026-11-01", amount: "100.00", member_id: "m", title: "tea", kind: "expense" });
  assert.equal(a, b);
  assert.equal(pctChange(120, 100), 20);
  assert.equal(pctChange(5, 0), null);
});
