// Run: node --test --experimental-strip-types tests/
import assert from "node:assert/strict";
import { register } from "node:module";
import { test } from "node:test";

// src/ uses extensionless relative imports (bundler style); resolve them to .ts for node.
register(
  "data:text/javascript," +
    encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  try { return await next(spec, ctx); }
  catch (e) {
    if (spec.startsWith(".") && !/\\.[a-z]+$/i.test(spec)) return next(spec + ".ts", ctx);
    throw e;
  }
}`),
);

const excel = await import("../src/lib/excel.ts");
const dates = await import("../src/lib/dates.ts");
const rules = await import("../src/lib/importRules.ts");

const NOW = new Date("2026-11-03T06:00:00Z"); // 11:30 IST

test("parses the date formats found in the owner's member sheet", () => {
  assert.deepEqual(excel.parseDateCell("24-February-1996"), { y: 1996, m: 2, d: 24 });
  assert.deepEqual(excel.parseDateCell("04-February-1972"), { y: 1972, m: 2, d: 4 });
  assert.deepEqual(excel.parseDateCell("12/20/1979", "mdy"), { y: 1979, m: 12, d: 20 });
  assert.deepEqual(excel.parseDateCell("4/6/2009", "mdy"), { y: 2009, m: 4, d: 6 });
  assert.deepEqual(excel.parseDateCell("4/6/2009", "dmy"), { y: 2009, m: 6, d: 4 });
  assert.deepEqual(excel.parseDateCell("30-June"), { y: null, m: 6, d: 30 });
  assert.deepEqual(excel.parseDateCell("24-September"), { y: null, m: 9, d: 24 });
  assert.deepEqual(excel.parseDateCell("2025-11-22"), { y: 2025, m: 11, d: 22 });
  assert.equal(excel.parseDateCell(""), null);
  assert.equal(excel.parseDateCell(null), null);
  assert.throws(() => excel.parseDateCell("31-February-2001"));
  assert.throws(() => excel.parseDateCell("hello"));
});

test("detects month/day order from a column", () => {
  assert.equal(excel.detectDateOrder(["12/20/1979", "7/1/1976", "7/7/1983"]), "mdy");
  assert.equal(excel.detectDateOrder(["4/6/2009", "2/25/2001", "5/15/2003", "11/4/2005"]), "mdy");
  assert.equal(excel.detectDateOrder(["20/12/1979"]), "dmy");
  assert.equal(excel.detectDateOrder(["4/6/2009"]), "dmy"); // ambiguous → Indian default
});

test("29 February birthdays fall on 28 February in non-leap years", () => {
  const n = dates.nextOccurrence(2, 29, new Date("2027-01-10T06:00:00Z"));
  assert.equal(n.iso, "2027-02-28");
  const leap = dates.nextOccurrence(2, 29, new Date("2028-01-10T06:00:00Z"));
  assert.equal(leap.iso, "2028-02-29");
});

test("celebrations: today counts, past dates roll to next year", () => {
  const today = dates.nextOccurrence(11, 3, NOW);
  assert.equal(today.daysUntil, 0);
  const passed = dates.nextOccurrence(11, 2, NOW);
  assert.equal(passed.iso, "2027-11-02");
  const soon = dates.nextOccurrence(11, 22, NOW);
  assert.equal(soon.daysUntil, 19);
});

test("phone numbers are normalised to 10 digits", () => {
  assert.equal(excel.parsePhone("98765 43210"), "9876543210");
  assert.equal(excel.parsePhone("+91 91234 56789"), "9123456789");
  assert.equal(excel.parsePhone(9811122233), "9811122233");
  assert.equal(excel.parsePhone(""), null);
  assert.throws(() => excel.parsePhone("12345"));
});

test("Hindi and English yes/no", () => {
  assert.equal(excel.parseYesNo("हाँ"), true);
  assert.equal(excel.parseYesNo("नहीं"), false);
  assert.equal(excel.parseYesNo("Yes"), true);
  assert.equal(excel.parseYesNo(""), null);
  assert.throws(() => excel.parseYesNo("maybe"));
});

const HEADERS = ["आपका पूरा नाम", "आपकी जन्मतिथि", "आपका मोबाइल नंबर", "क्या आपकी शादी हो चुकी है", "आपकी शादी की सालगिरह"];

test("auto-maps the Hindi Google-Form headers", () => {
  const m = excel.autoMap(HEADERS, rules.MEMBER_FIELDS);
  assert.equal(m.full_name, HEADERS[0]);
  assert.equal(m.dob, HEADERS[1]);
  assert.equal(m.phone, HEADERS[2]);
  assert.equal(m.married, HEADERS[3]);
  assert.equal(m.anniversary, HEADERS[4]);
});

const mapping = excel.autoMap(HEADERS, rules.MEMBER_FIELDS);
const row = (vals: unknown[], n = 2) => Object.fromEntries([["__row", n], ...HEADERS.map((h, i) => [h, vals[i] ?? null])]);

test("valid member row", () => {
  const r = rules.validateMemberRow(row(["रमेश वर्मा", "04-February-1972", "98765 43210", "हाँ", "21-June-1991"]), mapping, {}, NOW);
  assert.equal(r.status, "valid");
  assert.equal(r.data?.birth_year, 1972);
  assert.equal(r.data?.anniv_month, 6);
  assert.equal(r.data?.phone, "9876543210");
  assert.equal(r.data?.married, true);
});

test("DOB in 2024 is flagged", () => {
  const r = rules.validateMemberRow(row(["अनिल कुमार सिंह", "26-September-2024", "9000011111", "हाँ", "12-November-2024"]), mapping, {}, NOW);
  assert.equal(r.status, "warning");
  assert.ok(r.warnings.some((w) => w.includes("years old")));
});

test("anniversary while unmarried is flagged", () => {
  const r = rules.validateMemberRow(row(["राहुल शर्मा", "24-February-1996", "9123456789", "नहीं", "22-November-2025"]), mapping, {}, NOW);
  assert.equal(r.status, "warning");
  assert.ok(r.warnings.some((w) => w.includes("not married")));
});

test("day+month without year is accepted, missing year highlighted", () => {
  const r = rules.validateMemberRow(row(["Vijay Gupta", "24-September", null, null, null]), mapping, {}, NOW);
  assert.equal(r.data?.birth_day, 24);
  assert.equal(r.data?.birth_year, null);
  assert.ok(r.missing.includes("Birth year"));
  assert.ok(r.missing.includes("Mobile number"));
});

test("missing name is an error", () => {
  const r = rules.validateMemberRow(row([null, "24-February-1996"]), mapping, {}, NOW);
  assert.equal(r.status, "error");
});

test("duplicates: same name or DB phone → duplicate; shared phone in file → warning", () => {
  const a = rules.validateMemberRow(row(["Anil kumar singh", "26-September-1977", "9000011111", "हाँ", "06-December-2003"], 2), mapping, {}, NOW);
  const b = rules.validateMemberRow(row(["अनिल कुमार सिंह", "26-September-1977", "9000011111", "हाँ", ""], 3), mapping, {}, NOW);
  const c = rules.validateMemberRow(row(["Anil  Kumar Singh", "", "", "", ""], 4), mapping, {}, NOW);
  const d = rules.validateMemberRow(row(["Mohan Lal", "14-January-1976", "9000022222", "हाँ", "06-December-2004"], 5), mapping, {}, NOW);
  const out = rules.markMemberDuplicates([a, b, c, d], [{ full_name: "Someone", phone: "90000 22222" }]);
  assert.equal(out[0].status, "valid");
  assert.equal(out[1].status, "warning");
  assert.ok(out[1].warnings.some((w) => w.includes("Same mobile")));
  assert.equal(out[2].status, "duplicate");
  assert.equal(out[3].status, "duplicate");
});

test("event rows: validation, category mapping and duplicates", () => {
  const hdr = ["Title", "Date", "Time", "Category", "Venue"];
  const m = excel.autoMap(hdr, rules.EVENT_FIELDS);
  assert.equal(m.title, "Title");
  assert.equal(m.event_date, "Date");
  assert.equal(m.start_time, "Time");
  const ev = (v: unknown[], n: number) => Object.fromEntries([["__row", n], ...hdr.map((h, i) => [h, v[i] ?? null])]);
  const a = rules.validateEventRow(ev(["Diwali Milan", "15/11/2026", "6:30 PM", "त्योहार", "Pahil Vatika"], 2), m, {}, NOW);
  assert.equal(a.status, "valid");
  assert.equal(a.data?.category, "festival");
  assert.equal(a.data?.start_time, "18:30");
  const past = rules.validateEventRow(ev(["Yoga Day", "21/06/2026", "6:00", "yoga", "Garden"], 3), m, {}, NOW);
  assert.equal(past.status, "warning");
  const bad = rules.validateEventRow(ev(["", "", "", "", ""], 4), m, {}, NOW);
  assert.equal(bad.status, "error");
  const dup = rules.validateEventRow(ev(["diwali  milan", "2026-11-15", "", "", ""], 5), m, {}, NOW);
  const out = rules.markEventDuplicates([a, past, dup], []);
  assert.equal(out[2].status, "duplicate");
  assert.equal(rules.mapCategory("Pool Party"), "pool_party");
  assert.equal(rules.mapCategory("पिकनिक"), "picnic");
});
