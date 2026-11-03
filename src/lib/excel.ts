// Excel helpers: workbook reading, header detection, column auto-mapping, and
// strict date/time parsing. Pure functions (except file I/O) so they are unit-tested.
import * as XLSX from "xlsx";
import { safeCell } from "./format";

export interface SheetData {
  name: string;
  headerRow: number; // 0-based row index of the detected header
  headers: string[];
  rows: Record<string, unknown>[]; // keyed by header; __row = 1-based Excel row number
}

/** Read every sheet of an .xlsx / .xls / .csv file. Dates are kept as raw cells and parsed later. */
export async function readWorkbook(file: File): Promise<SheetData[]> {
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true, dense: true });
  return wb.SheetNames.map((name) => sheetToData(name, wb.Sheets[name]));
}

export function sheetToData(name: string, ws: XLSX.WorkSheet): SheetData {
  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, blankrows: true, raw: true });
  const headerRow = detectHeaderRow(grid);
  const rawHeaders = (grid[headerRow] ?? []).map((h) => String(h ?? "").trim());
  // De-duplicate / fill blank header names.
  const seen = new Map<string, number>();
  const headers = rawHeaders.map((h, i) => {
    const base = h || `Column ${i + 1}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n ? `${base} (${n + 1})` : base;
  });
  const rows: Record<string, unknown>[] = [];
  for (let r = headerRow + 1; r < grid.length; r++) {
    const line = grid[r] ?? [];
    if (line.every((c) => c === null || String(c).trim() === "")) continue;
    const obj: Record<string, unknown> = { __row: r + 1 };
    headers.forEach((h, i) => (obj[h] = line[i] ?? null));
    rows.push(obj);
  }
  return { name, headerRow, headers, rows };
}

/** First row among the first 15 that has at least 2 non-empty text cells. */
export function detectHeaderRow(grid: unknown[][]): number {
  for (let r = 0; r < Math.min(15, grid.length); r++) {
    const cells = (grid[r] ?? []).filter((c) => c !== null && String(c).trim() !== "");
    if (cells.length >= 2 && cells.filter((c) => typeof c === "string").length >= Math.ceil(cells.length / 2)) return r;
  }
  return 0;
}

export interface FieldDef {
  key: string;
  label: string;
  required?: boolean;
  synonyms: string[]; // lower-case fragments (English + Hindi) used for auto-mapping
}

const norm = (s: string) => s.toLowerCase().replace(/[\s_\-:.()?।]/g, "");

/** Map each field to the best-matching header (or "" when none). */
export function autoMap(headers: string[], fields: FieldDef[]): Record<string, string> {
  const used = new Set<string>();
  const out: Record<string, string> = {};
  for (const f of fields) {
    const cands = [f.key, f.label, ...f.synonyms].map(norm);
    const hit =
      headers.find((h) => !used.has(h) && cands.includes(norm(h))) ??
      headers.find((h) => !used.has(h) && cands.some((c) => c.length > 2 && norm(h).includes(c)));
    out[f.key] = hit ?? "";
    if (hit) used.add(hit);
  }
  return out;
}

// ---------------------------------------------------------------------------- dates
export type DateOrder = "dmy" | "mdy";
export interface ParsedDate {
  y: number | null; // null when the cell has only day + month ("30-June")
  m: number;
  d: number;
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
  "जनवरी": 1, "फरवरी": 2, "फ़रवरी": 2, "मार्च": 3, "अप्रैल": 4, "मई": 5, "जून": 6, "जुलाई": 7, "अगस्त": 8,
  "सितंबर": 9, "सितम्बर": 9, "अक्टूबर": 10, "नवंबर": 11, "नवम्बर": 11, "दिसंबर": 12, "दिसम्बर": 12,
};

function valid(y: number | null, m: number, d: number): boolean {
  if (!(m >= 1 && m <= 12 && d >= 1)) return false;
  const max = y === null ? [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1] : new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= max && (y === null || (y >= 1900 && y <= 2100));
}

function fixYear(y: number): number {
  if (y >= 100) return y;
  return y <= (new Date().getFullYear() % 100) ? 2000 + y : 1900 + y; // "96" → 1996, "05" → 2005
}

/**
 * Parse a date cell. Accepts JS Dates (from cellDates), Excel serial numbers,
 * ISO "2025-11-22", "24-February-1996", "24 Feb 1996", "30-June" (no year) and
 * numeric "12/20/1979" with the given day/month order. Returns null for blanks;
 * throws an Error with a readable message for unparseable values.
 */
export function parseDateCell(v: unknown, order: DateOrder = "dmy"): ParsedDate | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) throw new Error("Invalid date");
    // SheetJS creates dates at local midnight; read local parts so the calendar day is preserved.
    return { y: v.getFullYear(), m: v.getMonth() + 1, d: v.getDate() };
  }
  if (typeof v === "number") {
    const p = XLSX.SSF.parse_date_code(v);
    if (!p || !valid(p.y, p.m, p.d)) throw new Error(`Invalid date number ${v}`);
    return { y: p.y, m: p.m, d: p.d };
  }
  const s = String(v).trim().replace(/\s+/g, " ");
  if (!s || s === "-" || /^n\/?a$/i.test(s)) return null;

  let m: RegExpExecArray | null;
  // ISO yyyy-mm-dd
  if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/.exec(s))) {
    const r = { y: +m[1], m: +m[2], d: +m[3] };
    if (valid(r.y, r.m, r.d)) return r;
    throw new Error(`Invalid date "${s}"`);
  }
  // numeric a/b/c
  if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(s))) {
    const a = +m[1], b = +m[2], y = fixYear(+m[3]);
    const r = order === "mdy" ? { y, m: a, d: b } : { y, m: b, d: a };
    if (valid(r.y, r.m, r.d)) return r;
    // Unambiguous the other way round (e.g. 25/2 in an m/d column)?
    const alt = order === "mdy" ? { y, m: b, d: a } : { y, m: a, d: b };
    if (valid(alt.y, alt.m, alt.d)) return alt;
    throw new Error(`Invalid date "${s}"`);
  }
  // numeric day/month without year: "30/06"
  if ((m = /^(\d{1,2})[-/.](\d{1,2})$/.exec(s))) {
    const a = +m[1], b = +m[2];
    const r = order === "mdy" ? { y: null, m: a, d: b } : { y: null, m: b, d: a };
    if (valid(null, r.m, r.d)) return r;
    throw new Error(`Invalid date "${s}"`);
  }
  // "24-February-1996", "24 Feb 1996", "24 February", "30-June"
  if ((m = /^(\d{1,2})(?:st|nd|rd|th)?[-/. ,]+([^\d\s,./-]+)[-/. ,]*(\d{2,4})?$/i.exec(s))) {
    const mon = MONTHS[m[2].toLowerCase()];
    if (!mon) throw new Error(`Unknown month "${m[2]}"`);
    const r = { y: m[3] ? fixYear(+m[3]) : null, m: mon, d: +m[1] };
    if (valid(r.y, r.m, r.d)) return r;
    throw new Error(`Invalid date "${s}"`);
  }
  // "February 24, 1996", "June 30"
  if ((m = /^([^\d\s,./-]+)[-/. ,]+(\d{1,2})(?:st|nd|rd|th)?(?:[-/. ,]+(\d{2,4}))?$/i.exec(s))) {
    const mon = MONTHS[m[1].toLowerCase()];
    if (!mon) throw new Error(`Unknown month "${m[1]}"`);
    const r = { y: m[3] ? fixYear(+m[3]) : null, m: mon, d: +m[2] };
    if (valid(r.y, r.m, r.d)) return r;
    throw new Error(`Invalid date "${s}"`);
  }
  throw new Error(`Cannot read date "${s}"`);
}

/**
 * Decide day/month order for a whole column: a first number > 12 proves d/m,
 * a second number > 12 proves m/d. Falls back to `fallback` (India uses d/m).
 */
export function detectDateOrder(values: unknown[], fallback: DateOrder = "dmy"): DateOrder {
  let dmy = 0, mdy = 0;
  for (const v of values) {
    const m = typeof v === "string" ? /^\s*(\d{1,2})[-/.](\d{1,2})(?:[-/.]\d{2,4})?\s*$/.exec(v) : null;
    if (!m) continue;
    if (+m[1] > 12) dmy++;
    if (+m[2] > 12) mdy++;
  }
  if (dmy > mdy) return "dmy";
  if (mdy > dmy) return "mdy";
  return fallback;
}

export function isoFromParsed(p: ParsedDate): string | null {
  if (p.y === null) return null;
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/** Parse a time cell ("6:30 AM", "18:00", Excel fraction, Date) → "HH:MM". */
export function parseTimeCell(v: unknown): string | null {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  if (v instanceof Date) return `${String(v.getHours()).padStart(2, "0")}:${String(v.getMinutes()).padStart(2, "0")}`;
  if (typeof v === "number" && v >= 0 && v < 1) {
    const mins = Math.round(v * 24 * 60);
    return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
  }
  const m = /^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/i.exec(String(v).trim());
  if (!m) throw new Error(`Cannot read time "${v}"`);
  let h = +m[1];
  const min = m[2] ? +m[2] : 0;
  const ap = m[3]?.toLowerCase().replace(/\./g, "");
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) throw new Error(`Invalid time "${v}"`);
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** Normalise an Indian mobile number: strip spaces/+91/leading 0 → 10 digits, or throw. */
export function parsePhone(v: unknown): string | null {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  let d = String(v).replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (!/^[6-9]\d{9}$/.test(d)) throw new Error(`Invalid mobile number "${v}"`);
  return d;
}

/** Yes/No in English or Hindi → boolean (null for blank). */
export function parseYesNo(v: unknown): boolean | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().toLowerCase();
  if (!s) return null;
  if (["yes", "y", "true", "1", "हाँ", "हां", "हा", "married", "विवाहित"].includes(s)) return true;
  if (["no", "n", "false", "0", "नहीं", "नही", "unmarried", "अविवाहित"].includes(s)) return false;
  throw new Error(`Expected yes/no, got "${v}"`);
}

export function parseAmount(v: unknown): number | null {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  if (typeof v === "number") return Math.round(v * 100) / 100;
  const n = Number(String(v).replace(/[₹,\s]|rs\.?|inr/gi, ""));
  if (!Number.isFinite(n)) throw new Error(`Invalid amount "${v}"`);
  return Math.round(n * 100) / 100;
}

export const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
};

// ---------------------------------------------------------------------------- export
/** Download an .xlsx with one sheet per entry. Cells are formula-neutralised. */
export function downloadXlsx(filename: string, sheets: { name: string; rows: Record<string, unknown>[] }[]) {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const clean = s.rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, safeCell(v)])));
    const ws = XLSX.utils.json_to_sheet(clean.length ? clean : [{ "": "No data" }]);
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  }
  XLSX.writeFile(wb, filename);
}
