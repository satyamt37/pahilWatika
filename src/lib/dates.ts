// Date helpers. The community lives in IST, so "today" is always the Asia/Kolkata
// calendar date regardless of the viewer's device timezone.

export const TZ = "Asia/Kolkata";

/** Today's date in IST as {y, m (1-12), d}. */
export function todayIST(now: Date = new Date()): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(now)
    .reduce<Record<string, string>>((acc, p) => ((acc[p.type] = p.value), acc), {});
  return { y: +parts.year, m: +parts.month, d: +parts.day };
}

/** Today's IST date as YYYY-MM-DD. */
export function todayISO(now: Date = new Date()): string {
  const t = todayIST(now);
  return ymd(t.y, t.m, t.d);
}

export function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Day number (UTC-based, so DST-free) for date arithmetic on calendar dates. */
function dayNum(y: number, m: number, d: number): number {
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

/**
 * The date a recurring day/month falls on in year `y`. A 29 February birthday is
 * celebrated on 28 February in non-leap years.
 */
export function occurrenceInYear(month: number, day: number, y: number): { y: number; m: number; d: number } {
  if (month === 2 && day === 29 && !isLeapYear(y)) return { y, m: 2, d: 28 };
  return { y, m: month, d: Math.min(day, daysInMonth(y, month)) };
}

/** Next occurrence (today counts) of a recurring day/month, and days until it. */
export function nextOccurrence(month: number, day: number, now: Date = new Date()) {
  const t = todayIST(now);
  let occ = occurrenceInYear(month, day, t.y);
  if (dayNum(occ.y, occ.m, occ.d) < dayNum(t.y, t.m, t.d)) occ = occurrenceInYear(month, day, t.y + 1);
  const daysUntil = dayNum(occ.y, occ.m, occ.d) - dayNum(t.y, t.m, t.d);
  return { ...occ, iso: ymd(occ.y, occ.m, occ.d), daysUntil };
}

export interface Celebration<T> {
  kind: "birthday" | "anniversary";
  item: T;
  month: number;
  day: number;
  year: number | null;
  date: string; // next occurrence YYYY-MM-DD
  daysUntil: number;
  years: number | null; // age turning / anniversary number, when the year is known
}

export interface HasDates {
  birth_day: number | null;
  birth_month: number | null;
  birth_year: number | null;
  anniv_day: number | null;
  anniv_month: number | null;
  anniv_year: number | null;
}

/** All upcoming birthdays/anniversaries within `withinDays` (0 = today only), soonest first. */
export function upcomingCelebrations<T extends HasDates>(items: T[], withinDays: number, now: Date = new Date()): Celebration<T>[] {
  const out: Celebration<T>[] = [];
  for (const item of items) {
    const pairs: [Celebration<T>["kind"], number | null, number | null, number | null][] = [
      ["birthday", item.birth_month, item.birth_day, item.birth_year],
      ["anniversary", item.anniv_month, item.anniv_day, item.anniv_year],
    ];
    for (const [kind, m, d, y] of pairs) {
      if (!m || !d) continue;
      const n = nextOccurrence(m, d, now);
      if (n.daysUntil <= withinDays) {
        const years = y ? n.y - y : null;
        // A year in the future (e.g. a typo) yields no sensible count — hide it.
        out.push({ kind, item, month: m, day: d, year: y, date: n.iso, daysUntil: n.daysUntil, years: years !== null && years > 0 ? years : null });
      }
    }
  }
  return out.sort((a, b) => a.daysUntil - b.daysUntil || a.kind.localeCompare(b.kind));
}

/** All celebrations whose day falls in month `m` (1-12) of year `y`, by day. */
export function celebrationsInMonth<T extends HasDates>(items: T[], y: number, m: number) {
  const out: { kind: "birthday" | "anniversary"; item: T; day: number; years: number | null }[] = [];
  for (const item of items) {
    if (item.birth_month && item.birth_day) {
      const o = occurrenceInYear(item.birth_month, item.birth_day, y);
      const yrs = item.birth_year ? y - item.birth_year : null;
      if (o.m === m) out.push({ kind: "birthday", item, day: o.d, years: yrs && yrs > 0 ? yrs : null });
    }
    if (item.anniv_month && item.anniv_day) {
      const o = occurrenceInYear(item.anniv_month, item.anniv_day, y);
      const yrs = item.anniv_year ? y - item.anniv_year : null;
      if (o.m === m) out.push({ kind: "anniversary", item, day: o.d, years: yrs && yrs > 0 ? yrs : null });
    }
  }
  return out.sort((a, b) => a.day - b.day);
}

/** Days between today (IST) and an ISO date; negative = past. */
export function daysFromToday(iso: string, now: Date = new Date()): number {
  const t = todayIST(now);
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return dayNum(y, m, d) - dayNum(t.y, t.m, t.d);
}

/** Milliseconds from now until an IST date/time (time HH:MM[:SS], default start of day). */
export function msUntilIST(isoDate: string, time: string | null, now: Date = new Date()): number {
  const [hh = "00", mm = "00"] = (time ?? "00:00").split(":");
  // IST is a fixed UTC+05:30 with no daylight saving.
  const target = Date.parse(`${isoDate}T${hh.padStart(2, "0")}:${mm.padStart(2, "0")}:00+05:30`);
  return target - now.getTime();
}

/** Ordinal suffix for English: 1st, 2nd, 3rd, 11th… */
export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export const MONTHS_HI = ["जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर"];
export const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function dayMonthLabel(day: number, month: number, lang: "hi" | "en" = "en"): string {
  return `${day} ${(lang === "hi" ? MONTHS_HI : MONTHS_EN)[month - 1]}`;
}

/** "Sat, 14 Nov 2026" for an ISO date (calendar date, no TZ shift). */
export function formatDate(
  iso: string | null | undefined,
  opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short", year: "numeric" },
): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", { ...opts, timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** Timestamp → readable IST date+time. */
export function formatDateTime(ts: string | null | undefined): string {
  if (!ts) return "";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: TZ, day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit",
  }).format(new Date(ts));
}

/** "06:30:00" → "6:30 AM". */
export function formatTime(t: string | null | undefined): string {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const ap = h >= 12 ? "PM" : "AM";
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${ap}`;
}

export function relativeDays(n: number): string {
  if (n === 0) return "आज · Today";
  if (n === 1) return "कल · Tomorrow";
  return `${n} दिन में · in ${n} days`;
}
