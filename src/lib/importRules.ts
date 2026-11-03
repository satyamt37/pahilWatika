// Validation and normalisation rules for the Excel importer. Pure functions so
// they can be unit-tested with node:test (see tests/import.test.ts).
import { z } from "zod";
import {
  isoFromParsed, parseDateCell, parsePhone, parseTimeCell, parseYesNo, str,
  type DateOrder, type FieldDef, type ParsedDate,
} from "./excel.ts";
import { todayIST } from "./dates.ts";
import type { EventCategory } from "./types.ts";

export type RowStatus = "valid" | "warning" | "duplicate" | "error";

export interface RowResult<T> {
  row: number; // Excel row number
  data: T | null;
  errors: string[];
  warnings: string[];
  missing: string[];
  duplicateOf: string | null;
  status: RowStatus;
}

function finish<T>(r: Omit<RowResult<T>, "status">): RowResult<T> {
  const status: RowStatus = r.errors.length ? "error" : r.duplicateOf ? "duplicate" : r.warnings.length || r.missing.length ? "warning" : "valid";
  return { ...r, status };
}

/** Recompute status after duplicate flags/warnings are added. */
export function restatus<T>(r: RowResult<T>): RowResult<T> {
  const { status: _s, ...rest } = r;
  return finish(rest);
}

/** Lower-case, Unicode-normalised name without punctuation or repeated spaces. */
export function normaliseName(s: string): string {
  return s.normalize("NFC").toLowerCase().replace(/[.,'"`()\-_]/g, " ").replace(/\s+/g, " ").trim();
}

/** Tidy a person's name for storage: trim, collapse spaces, Title-case Latin words. */
export function tidyName(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((w) => (/^[a-z]/i.test(w) ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ");
}

// ---------------------------------------------------------------------------- field definitions
export const MEMBER_FIELDS: FieldDef[] = [
  { key: "full_name", label: "Full name", required: true, synonyms: ["name", "full name", "member name", "नाम", "पूरा नाम", "आपका पूरा नाम", "सदस्य का नाम"] },
  { key: "dob", label: "Date of birth", synonyms: ["dob", "date of birth", "birth date", "birthday", "जन्मतिथि", "जन्म तिथि", "आपकी जन्मतिथि", "जन्मदिन"] },
  { key: "phone", label: "Mobile number", synonyms: ["mobile", "mobile number", "phone", "phone number", "contact", "मोबाइल", "मोबाइल नंबर", "आपका मोबाइल नंबर", "फोन", "फ़ोन"] },
  { key: "married", label: "Married? (yes/no)", synonyms: ["married", "marital status", "is married", "विवाहित", "शादी हो चुकी", "क्या आपकी शादी हो चुकी है"] },
  { key: "anniversary", label: "Wedding anniversary", synonyms: ["anniversary", "wedding anniversary", "marriage anniversary", "wedding date", "सालगिरह", "शादी की सालगिरह", "आपकी शादी की सालगिरह", "वर्षगाँठ"] },
  { key: "email", label: "Email", synonyms: ["email", "e-mail", "email address", "ईमेल"] },
  { key: "profession", label: "Profession / designation", synonyms: ["profession", "designation", "occupation", "पद", "व्यवसाय", "पेशा"] },
  { key: "joining_date", label: "Joining date", synonyms: ["joining date", "joined", "date of joining", "member since", "जुड़ने की तिथि"] },
  { key: "address", label: "Address", synonyms: ["address", "पता"] },
  { key: "bio", label: "Short bio", synonyms: ["bio", "about", "biography", "परिचय"] },
];
export const MEMBER_DATE_FIELDS = ["dob", "anniversary", "joining_date"];

export const EVENT_FIELDS: FieldDef[] = [
  { key: "title", label: "Title", required: true, synonyms: ["title", "event", "event name", "name", "कार्यक्रम", "शीर्षक", "कार्यक्रम का नाम"] },
  { key: "event_date", label: "Date", required: true, synonyms: ["date", "event date", "दिनांक", "तारीख", "तिथि"] },
  { key: "start_time", label: "Start time", synonyms: ["start time", "start", "time", "from", "समय", "प्रारंभ"] },
  { key: "end_time", label: "End time", synonyms: ["end time", "end", "to", "till", "समाप्ति"] },
  { key: "category", label: "Category", synonyms: ["category", "type", "event type", "श्रेणी", "प्रकार"] },
  { key: "venue", label: "Venue", synonyms: ["venue", "place", "location", "स्थान", "जगह"] },
  { key: "description", label: "Description", synonyms: ["description", "details", "about", "विवरण"] },
  { key: "organizer", label: "Organizer", synonyms: ["organizer", "organiser", "host", "आयोजक"] },
  { key: "max_capacity", label: "Max capacity", synonyms: ["capacity", "max capacity", "seats", "limit", "क्षमता"] },
  { key: "registration_info", label: "Registration details", synonyms: ["registration", "registration details", "contribution", "fee", "पंजीकरण"] },
  { key: "instructions", label: "Instructions", synonyms: ["instructions", "notes", "निर्देश"] },
];
export const EVENT_DATE_FIELDS = ["event_date"];

// ---------------------------------------------------------------------------- categories
const CATEGORY_WORDS: [EventCategory, string[]][] = [
  ["pool_party", ["pool", "पूल", "swimming", "तैराकी"]],
  ["yoga", ["yoga", "योग", "योगा", "pranayam", "प्राणायाम", "meditation", "ध्यान"]],
  ["meeting", ["meeting", "बैठक", "मीटिंग", "सभा", "agm"]],
  ["picnic", ["picnic", "पिकनिक", "वनभोज"]],
  ["festival", ["festival", "त्योहार", "त्यौहार", "उत्सव", "पर्व", "diwali", "दीवाली", "दिवाली", "holi", "होली", "navratri", "नवरात्रि", "rakhi", "राखी"]],
  ["birthday", ["birthday", "जन्मदिन", "बर्थडे"]],
  ["anniversary", ["anniversary", "सालगिरह", "वर्षगाँठ", "वर्षगांठ"]],
  ["outing", ["outing", "सैर", "trip", "tour", "यात्रा", "भ्रमण", "travel"]],
  ["other", ["other", "अन्य"]],
];

/** Map an English/Hindi category word to an event category (null if unrecognised). */
export function mapCategory(v: unknown): EventCategory | null {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return null;
  const key = s.replace(/[\s-]+/g, "_");
  if (CATEGORY_WORDS.some(([k]) => k === key)) return key as EventCategory;
  for (const [cat, words] of CATEGORY_WORDS) if (words.some((w) => s.includes(w))) return cat;
  return null;
}

// ---------------------------------------------------------------------------- members
export interface MemberDraft {
  full_name: string;
  birth_day: number | null;
  birth_month: number | null;
  birth_year: number | null;
  married: boolean | null;
  anniv_day: number | null;
  anniv_month: number | null;
  anniv_year: number | null;
  phone: string | null;
  email: string | null;
  profession: string | null;
  joining_date: string | null;
  address: string | null;
  bio: string | null;
}

const memberSchema = z.object({
  full_name: z.string().min(2, "Name is too short").max(120, "Name is too long"),
  email: z.string().email("Invalid email").nullable(),
  phone: z.string().regex(/^[6-9]\d{9}$/).nullable(),
  profession: z.string().max(120).nullable(),
  address: z.string().max(500).nullable(),
  bio: z.string().max(2000).nullable(),
});

type Mapping = Record<string, string>;
const cell = (raw: Record<string, unknown>, mapping: Mapping, key: string) => (mapping[key] ? raw[mapping[key]] : null);

function tryParse<T>(fn: () => T, errors: string[], label: string): T | null {
  try {
    return fn();
  } catch (e) {
    errors.push(`${label}: ${(e as Error).message}`);
    return null;
  }
}

function cmpDate(a: ParsedDate & { y: number }, b: { y: number; m: number; d: number }): number {
  return a.y - b.y || a.m - b.m || a.d - b.d;
}

export function validateMemberRow(
  raw: Record<string, unknown>,
  mapping: Mapping,
  orders: Record<string, DateOrder> = {},
  now: Date = new Date(),
): RowResult<MemberDraft> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const missing: string[] = [];
  const row = Number(raw.__row ?? 0);
  const today = todayIST(now);

  const name = str(cell(raw, mapping, "full_name"));
  if (!name) errors.push("Name is missing");

  const dob = tryParse(() => parseDateCell(cell(raw, mapping, "dob"), orders.dob ?? "dmy"), errors, "Date of birth");
  const anniv = tryParse(() => parseDateCell(cell(raw, mapping, "anniversary"), orders.anniversary ?? "dmy"), errors, "Anniversary");
  const joining = tryParse(() => parseDateCell(cell(raw, mapping, "joining_date"), orders.joining_date ?? "dmy"), errors, "Joining date");
  const phone = tryParse(() => parsePhone(cell(raw, mapping, "phone")), errors, "Mobile");
  const married = tryParse(() => parseYesNo(cell(raw, mapping, "married")), errors, "Married");

  if (!dob && mapping.dob && !errors.some((e) => e.startsWith("Date of birth"))) missing.push("Date of birth");
  if (!phone && mapping.phone && !errors.some((e) => e.startsWith("Mobile"))) missing.push("Mobile number");
  if (married === true && !anniv && mapping.anniversary && !errors.some((e) => e.startsWith("Anniversary"))) missing.push("Anniversary date");
  if (dob && dob.y === null) missing.push("Birth year");

  if (dob && dob.y !== null) {
    const age = today.y - dob.y - (dob.m > today.m || (dob.m === today.m && dob.d > today.d) ? 1 : 0);
    if (cmpDate(dob as ParsedDate & { y: number }, today) > 0) warnings.push(`Date of birth ${isoFromParsed(dob)} is in the future — please check`);
    else if (age < 5) warnings.push(`Date of birth ${isoFromParsed(dob)} makes the member ${age} years old — please check`);
  }
  if (anniv && married === false) warnings.push("Anniversary given but marked as not married — please check");
  if (anniv && anniv.y !== null && cmpDate(anniv as ParsedDate & { y: number }, today) > 0) {
    warnings.push(`Anniversary ${isoFromParsed(anniv)} is in the future — please check`);
  }
  if (anniv && anniv.y !== null && dob && dob.y !== null && anniv.y - dob.y < 15) {
    warnings.push("Anniversary year is too close to the birth year — please check");
  }
  if (joining && joining.y === null) errors.push("Joining date needs a year");

  if (errors.length || !name) return finish<MemberDraft>({ row, data: null, errors, warnings, missing, duplicateOf: null });

  const draft: MemberDraft = {
    full_name: tidyName(name),
    birth_day: dob?.d ?? null,
    birth_month: dob?.m ?? null,
    birth_year: dob?.y ?? null,
    married: married ?? (anniv ? true : null),
    anniv_day: anniv?.d ?? null,
    anniv_month: anniv?.m ?? null,
    anniv_year: anniv?.y ?? null,
    phone,
    email: str(cell(raw, mapping, "email"))?.toLowerCase() ?? null,
    profession: str(cell(raw, mapping, "profession")),
    joining_date: joining ? isoFromParsed(joining) : null,
    address: str(cell(raw, mapping, "address")),
    bio: str(cell(raw, mapping, "bio")),
  };
  const z1 = memberSchema.safeParse(draft);
  if (!z1.success) {
    for (const i of z1.error.issues) errors.push(`${i.path.join(".")}: ${i.message}`);
    return finish<MemberDraft>({ row, data: null, errors, warnings, missing, duplicateOf: null });
  }
  return finish<MemberDraft>({ row, data: draft, errors, warnings, missing, duplicateOf: null });
}

/**
 * Flag duplicates: same normalised name or same phone as an existing member, or
 * same name as an earlier row in the file → "duplicate". A phone shared with an
 * earlier row under a different name (families often share a number) → warning.
 */
export function markMemberDuplicates(
  results: RowResult<MemberDraft>[],
  existing: { full_name: string; phone: string | null }[],
): RowResult<MemberDraft>[] {
  const dbNames = new Map(existing.map((e) => [normaliseName(e.full_name), e.full_name]));
  const dbPhones = new Map<string, string>();
  for (const e of existing) {
    if (!e.phone) continue;
    try {
      const p = parsePhone(e.phone);
      if (p) dbPhones.set(p, e.full_name);
    } catch {
      /* ignore malformed stored numbers */
    }
  }
  const fileNames = new Map<string, number>();
  const filePhones = new Map<string, { row: number; name: string }>();
  return results.map((r) => {
    if (!r.data) return r;
    const out = { ...r, warnings: [...r.warnings] };
    const n = normaliseName(r.data.full_name);
    if (dbNames.has(n)) out.duplicateOf = `Already a member: ${dbNames.get(n)}`;
    else if (r.data.phone && dbPhones.has(r.data.phone)) out.duplicateOf = `Mobile already used by member ${dbPhones.get(r.data.phone)}`;
    else if (fileNames.has(n)) out.duplicateOf = `Same name as row ${fileNames.get(n)}`;
    if (r.data.phone && filePhones.has(r.data.phone) && !out.duplicateOf) {
      const prev = filePhones.get(r.data.phone)!;
      out.warnings.push(`Same mobile number as row ${prev.row} (${prev.name})`);
    }
    if (!fileNames.has(n)) fileNames.set(n, r.row);
    if (r.data.phone && !filePhones.has(r.data.phone)) filePhones.set(r.data.phone, { row: r.row, name: r.data.full_name });
    return restatus(out);
  });
}

// ---------------------------------------------------------------------------- events
export interface EventDraft {
  title: string;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  category: EventCategory;
  venue: string | null;
  description: string | null;
  organizer: string | null;
  max_capacity: number | null;
  registration_info: string | null;
  instructions: string | null;
}

const eventSchema = z.object({
  title: z.string().min(2, "Title is too short").max(200, "Title is too long"),
  event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  max_capacity: z.number().int().positive().nullable(),
});

export function validateEventRow(
  raw: Record<string, unknown>,
  mapping: Mapping,
  orders: Record<string, DateOrder> = {},
  now: Date = new Date(),
): RowResult<EventDraft> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const missing: string[] = [];
  const row = Number(raw.__row ?? 0);

  const title = str(cell(raw, mapping, "title"));
  if (!title) errors.push("Title is missing");
  const d = tryParse(() => parseDateCell(cell(raw, mapping, "event_date"), orders.event_date ?? "dmy"), errors, "Date");
  if (!d && !errors.some((e) => e.startsWith("Date"))) errors.push("Date is missing");
  if (d && d.y === null) errors.push("Date needs a year");
  const start = tryParse(() => parseTimeCell(cell(raw, mapping, "start_time")), errors, "Start time");
  const end = tryParse(() => parseTimeCell(cell(raw, mapping, "end_time")), errors, "End time");
  if (start && end && end < start) errors.push("End time is before start time");

  const catRaw = str(cell(raw, mapping, "category"));
  let category = mapCategory(catRaw);
  if (catRaw && !category) warnings.push(`Unknown category "${catRaw}" — saved as Other`);
  if (!category) category = mapCategory(title) ?? "other";

  let cap: number | null = null;
  const capRaw = str(cell(raw, mapping, "max_capacity"));
  if (capRaw) {
    cap = Number(capRaw.replace(/[^\d.]/g, ""));
    if (!Number.isInteger(cap) || cap <= 0) {
      errors.push(`Capacity "${capRaw}" is not a whole number`);
      cap = null;
    }
  }
  const venue = str(cell(raw, mapping, "venue"));
  if (!venue) missing.push("Venue");
  if (!start) missing.push("Start time");

  if (errors.length || !title || !d || d.y === null) return finish<EventDraft>({ row, data: null, errors, warnings, missing, duplicateOf: null });
  const iso = isoFromParsed(d)!;
  const t = todayIST(now);
  if (cmpDate(d as ParsedDate & { y: number }, t) < 0) warnings.push("Date is in the past — it will appear under Past events");

  const draft: EventDraft = {
    title: title.replace(/\s+/g, " "),
    event_date: iso,
    start_time: start,
    end_time: end,
    category,
    venue,
    description: str(cell(raw, mapping, "description")),
    organizer: str(cell(raw, mapping, "organizer")),
    max_capacity: cap,
    registration_info: str(cell(raw, mapping, "registration_info")),
    instructions: str(cell(raw, mapping, "instructions")),
  };
  const z1 = eventSchema.safeParse(draft);
  if (!z1.success) {
    for (const i of z1.error.issues) errors.push(`${i.path.join(".")}: ${i.message}`);
    return finish<EventDraft>({ row, data: null, errors, warnings, missing, duplicateOf: null });
  }
  return finish<EventDraft>({ row, data: draft, errors, warnings, missing, duplicateOf: null });
}

export const eventKey = (title: string, date: string) => `${title.trim().toLowerCase().replace(/\s+/g, " ")}|${date}`;

/** Same title + date as an existing event or an earlier row → duplicate. */
export function markEventDuplicates(results: RowResult<EventDraft>[], existing: { title: string; event_date: string }[]): RowResult<EventDraft>[] {
  const db = new Set(existing.map((e) => eventKey(e.title, e.event_date)));
  const seen = new Map<string, number>();
  return results.map((r) => {
    if (!r.data) return r;
    const k = eventKey(r.data.title, r.data.event_date);
    const out = { ...r };
    if (db.has(k)) out.duplicateOf = "An event with this title already exists on this date";
    else if (seen.has(k)) out.duplicateOf = `Same event as row ${seen.get(k)}`;
    if (!seen.has(k)) seen.set(k, r.row);
    return restatus(out);
  });
}
