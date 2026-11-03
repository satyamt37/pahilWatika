"use client";
import { AlertTriangle, ArrowLeft, CheckCircle2, Copy, Download, FileSpreadsheet, History, Upload, XCircle } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useToast } from "@/components/toast";
import {
  Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, Loading, Select, StatCard, Tabs,
} from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { formatDateTime, formatTime, MONTHS_EN } from "@/lib/dates";
import { autoMap, detectDateOrder, downloadXlsx, readWorkbook, type DateOrder, type FieldDef, type SheetData } from "@/lib/excel";
import { clsx } from "@/lib/format";
import { must, useLoad } from "@/lib/hooks";
import {
  EVENT_DATE_FIELDS, EVENT_FIELDS, MEMBER_DATE_FIELDS, MEMBER_FIELDS, markEventDuplicates, markMemberDuplicates,
  validateEventRow, validateMemberRow, type EventDraft, type MemberDraft, type RowResult, type RowStatus,
} from "@/lib/importRules";
import { errMsg, supabase } from "@/lib/supabase";
import { EVENT_CATEGORIES } from "@/lib/types";

type Kind = "members" | "events";
type Step = "upload" | "map" | "preview" | "done";
type AnyResult = RowResult<MemberDraft> | RowResult<EventDraft>;

const MAX_BYTES = 10 * 1024 * 1024;
const CONFIG: Record<Kind, { fields: FieldDef[]; dateFields: string[]; hi: string }> = {
  members: { fields: MEMBER_FIELDS, dateFields: MEMBER_DATE_FIELDS, hi: "सदस्य" },
  events: { fields: EVENT_FIELDS, dateFields: EVENT_DATE_FIELDS, hi: "कार्यक्रम" },
};

interface Summary {
  batchId: string;
  total: number;
  imported: number;
  skipped: number;
  failed: number;
  report: Record<string, unknown>[];
}

interface Batch {
  id: string;
  kind: "members" | "events" | "transactions";
  file_name: string;
  sheet_name: string | null;
  total_rows: number;
  imported: number;
  skipped: number;
  failed: number;
  errors: { row: number; reason: string }[];
  created_at: string;
}

export default function ImportAdmin() {
  const { isAdmin } = useAuth();
  if (!isAdmin) {
    return (
      <EmptyState
        icon={<FileSpreadsheet className="h-7 w-7" />}
        title="सदस्य/कार्यक्रम इम्पोर्ट केवल एडमिन के लिए"
        text="Member and event imports are for administrators. To import financial records, use the Hisaab-Kitab tab."
      />
    );
  }
  return <Importer />;
}

function Importer() {
  const toast = useToast();
  const [kind, setKind] = useState<Kind>("members");
  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [sheets, setSheets] = useState<SheetData[]>([]);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [orders, setOrders] = useState<Record<string, DateOrder>>({});
  const [results, setResults] = useState<AnyResult[]>([]);
  const [include, setInclude] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState<RowStatus | "all">("all");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const history = useLoad(async () => must(await supabase.from("import_batches").select("*").in("kind", ["members", "events"]).order("created_at", { ascending: false }).limit(20)) as Batch[], []);

  const cfg = CONFIG[kind];
  const sheet = sheets[sheetIdx];

  const reset = (k: Kind = kind) => {
    setKind(k);
    setStep("upload");
    setSheets([]);
    setResults([]);
    setSummary(null);
    setFileName("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const prepareSheet = (s: SheetData, k: Kind) => {
    const m = autoMap(s.headers, CONFIG[k].fields);
    setMapping(m);
    const o: Record<string, DateOrder> = {};
    for (const f of CONFIG[k].dateFields) o[f] = m[f] ? detectDateOrder(s.rows.map((r) => r[m[f]])) : "dmy";
    setOrders(o);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) return toast.error("Please choose an Excel file (.xlsx, .xls) or .csv");
    if (file.size > MAX_BYTES) return toast.error("File is larger than 10 MB");
    setBusy(true);
    try {
      const all = await readWorkbook(file);
      const usable = all.filter((s) => s.rows.length > 0);
      if (!usable.length) throw new Error("No data rows were found in this workbook");
      setSheets(usable);
      setSheetIdx(0);
      setFileName(file.name);
      prepareSheet(usable[0], kind);
      setStep("map");
    } catch (e) {
      toast.error(`Could not read the file: ${errMsg(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const chooseSheet = (i: number) => {
    setSheetIdx(i);
    prepareSheet(sheets[i], kind);
  };

  const missingRequired = cfg.fields.filter((f) => f.required && !mapping[f.key]);

  const validate = async () => {
    if (!sheet) return;
    setBusy(true);
    try {
      const now = new Date();
      let res: AnyResult[];
      if (kind === "members") {
        const existing = must(await supabase.from("members").select("full_name,phone")) as { full_name: string; phone: string | null }[];
        res = markMemberDuplicates(sheet.rows.map((r) => validateMemberRow(r, mapping, orders, now)), existing);
      } else {
        const existing = must(await supabase.from("events").select("title,event_date")) as { title: string; event_date: string }[];
        res = markEventDuplicates(sheet.rows.map((r) => validateEventRow(r, mapping, orders, now)), existing);
      }
      setResults(res);
      setInclude(new Set(res.filter((r) => r.status === "valid" || r.status === "warning").map((r) => r.row)));
      setFilter("all");
      setStep("preview");
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const counts = useMemo(() => {
    const c = { valid: 0, warning: 0, duplicate: 0, error: 0 };
    for (const r of results) c[r.status]++;
    return c;
  }, [results]);

  const rawOf = (row: number) => {
    const r = sheet?.rows.find((x) => x.__row === row);
    if (!r) return {};
    return Object.fromEntries(sheet!.headers.map((h) => [h, r[h] instanceof Date ? (r[h] as Date).toDateString() : r[h] ?? ""]));
  };

  const runImport = async () => {
    setConfirm(false);
    setBusy(true);
    const chosen = results.filter((r) => include.has(r.row) && r.data);
    try {
      const batch = must(
        await supabase
          .from("import_batches")
          .insert({ kind, file_name: fileName, sheet_name: sheet?.name, total_rows: results.length, mapping: { mapping, orders } })
          .select("id")
          .single(),
      ) as { id: string };

      const toRow = (r: AnyResult): Record<string, unknown> =>
        kind === "members"
          ? {
              ...(r.data as MemberDraft),
              notes: [...r.warnings, ...r.missing.map((m) => `Missing: ${m}`)].join("; ") || null,
              import_batch_id: batch.id,
            }
          : { ...(r.data as EventDraft), import_batch_id: batch.id };

      const failed: { row: number; reason: string }[] = [];
      let imported = 0;
      const table = kind === "members" ? "members" : "events";
      for (let i = 0; i < chosen.length; i += 50) {
        const chunk = chosen.slice(i, i + 50);
        const { error } = await supabase.from(table).insert(chunk.map(toRow));
        if (!error) {
          imported += chunk.length;
          continue;
        }
        // Retry one by one so a single bad row doesn't block the rest.
        for (const r of chunk) {
          const { error: e1 } = await supabase.from(table).insert(toRow(r));
          if (e1) failed.push({ row: r.row, reason: errMsg(e1) });
          else imported++;
        }
      }

      const invalid = results.filter((r) => r.status === "error").map((r) => ({ row: r.row, reason: r.errors.join("; ") }));
      const skipped = results.filter((r) => r.status !== "error" && !include.has(r.row)).map((r) => ({
        row: r.row,
        reason: r.duplicateOf ? `Skipped duplicate: ${r.duplicateOf}` : "Skipped by admin",
      }));
      const allErrors = [...invalid, ...failed, ...skipped].sort((a, b) => a.row - b.row);
      await supabase
        .from("import_batches")
        .update({ imported, skipped: skipped.length, failed: invalid.length + failed.length, errors: allErrors })
        .eq("id", batch.id);

      const report = allErrors.map((e) => ({
        "Excel row": e.row,
        Outcome: e.reason.startsWith("Skipped") ? "Skipped" : "Failed",
        Reason: e.reason,
        ...rawOf(e.row),
      }));
      setSummary({ batchId: batch.id, total: results.length, imported, skipped: skipped.length, failed: invalid.length + failed.length, report });
      setStep("done");
      history.reload();
      if (imported) toast.success(`${imported} ${kind === "members" ? "सदस्य" : "कार्यक्रम"} इम्पोर्ट हुए · imported`);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const template = () => {
    const blank = Object.fromEntries(cfg.fields.map((f) => [f.label, ""]));
    const notes = cfg.fields.map((f) => ({
      Column: f.label,
      Required: f.required ? "Yes" : "No",
      Notes:
        f.key === "dob" ? "e.g. 24-02-1996 or 24-February-1996. Day + month only (24-February) is allowed." :
        f.key === "anniversary" ? "Wedding date, e.g. 21-06-1991" :
        f.key === "married" ? "Yes / No (हाँ / नहीं)" :
        f.key === "phone" ? "10-digit mobile number" :
        f.key === "event_date" ? "e.g. 15-11-2026" :
        f.key === "start_time" || f.key === "end_time" ? "e.g. 6:30 AM or 18:00" :
        f.key === "category" ? Object.values(EVENT_CATEGORIES).map((c) => c.en).join(", ") : "",
    }));
    downloadXlsx(`pahil-vatika-${kind}-template.xlsx`, [{ name: kind === "members" ? "Members" : "Events", rows: [blank] }, { name: "Instructions", rows: notes }]);
  };

  return (
    <div className="space-y-5">
      <Tabs<Kind>
        value={kind}
        onChange={(k) => reset(k)}
        items={[{ value: "members", label: "👥 सदस्य · Members" }, { value: "events", label: "📅 कार्यक्रम · Events" }]}
        className="mx-0 px-0"
      />
      <Stepper step={step} />

      {step === "upload" && (
        <Card className="p-4 sm:p-6">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); onFile(e.dataTransfer.files?.[0]); }}
            className={clsx("flex flex-col items-center rounded-2xl border-2 border-dashed px-4 py-10 text-center transition-colors", dragOver ? "border-leaf bg-leaf-50" : "border-forest/15")}
          >
            <FileSpreadsheet className="mb-3 h-10 w-10 text-leaf" />
            <p className="font-hindi text-lg font-semibold text-forest">{cfg.hi} की एक्सेल फ़ाइल चुनें</p>
            <p className="mt-1 text-sm text-muted">.xlsx, .xls or .csv · up to 10 MB · drag & drop or choose</p>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
            <Button className="mt-4" loading={busy} icon={<Upload className="h-4 w-4" />} onClick={() => fileRef.current?.click()}>फ़ाइल चुनें · Choose file</Button>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
            <span>Nothing is saved until you review the preview and confirm.</span>
            <Button variant="ghost" size="sm" icon={<Download className="h-4 w-4" />} onClick={template}>Template download</Button>
          </div>
        </Card>
      )}

      {step === "map" && sheet && (
        <Card className="space-y-5 p-4 sm:p-6">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone="forest"><FileSpreadsheet className="h-3.5 w-3.5" /> {fileName}</Badge>
            <span className="text-muted">Header detected on row {sheet.headerRow + 1} · {sheet.rows.length} data rows</span>
          </div>
          {sheets.length > 1 && (
            <Field label="शीट चुनें · Sheet">
              <Select value={sheetIdx} onChange={(e) => chooseSheet(Number(e.target.value))}>
                {sheets.map((s, i) => <option key={s.name} value={i}>{s.name} ({s.rows.length} rows)</option>)}
              </Select>
            </Field>
          )}
          <div>
            <h3 className="mb-1 font-semibold text-forest">कॉलम मिलान · Column mapping</h3>
            <p className="mb-3 text-sm text-muted">We matched columns automatically. Correct any that are wrong; leave “— Not in file —” for missing ones.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {cfg.fields.map((f) => (
                <Field key={f.key} label={f.label} required={f.required} error={f.required && !mapping[f.key] ? "Required" : null}>
                  <Select value={mapping[f.key] ?? ""} onChange={(e) => {
                    const v = e.target.value;
                    setMapping((m) => ({ ...m, [f.key]: v }));
                    if (cfg.dateFields.includes(f.key)) setOrders((o) => ({ ...o, [f.key]: v ? detectDateOrder(sheet.rows.map((r) => r[v])) : "dmy" }));
                  }}>
                    <option value="">— Not in file —</option>
                    {sheet.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </Select>
                </Field>
              ))}
            </div>
          </div>
          {cfg.dateFields.some((f) => mapping[f]) && (
            <div>
              <h3 className="mb-1 font-semibold text-forest">तारीख़ का क्रम · Date format</h3>
              <p className="mb-3 text-sm text-muted">For numeric dates like 4/6/2009 — detected from the column, change if wrong. Dates written with month names are always read correctly.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {cfg.dateFields.filter((f) => mapping[f]).map((f) => {
                  const sample = sheet.rows.map((r) => r[mapping[f]]).find((v) => typeof v === "string" && /^\d{1,2}[-/.]\d{1,2}/.test(v.trim()));
                  return (
                    <Field key={f} label={cfg.fields.find((x) => x.key === f)?.label ?? f} hint={sample ? `Example in file: ${String(sample)}` : undefined}>
                      <Select value={orders[f] ?? "dmy"} onChange={(e) => setOrders((o) => ({ ...o, [f]: e.target.value as DateOrder }))}>
                        <option value="dmy">Day / Month / Year (24/02/1996)</option>
                        <option value="mdy">Month / Day / Year (02/24/1996)</option>
                      </Select>
                    </Field>
                  );
                })}
              </div>
            </div>
          )}
          <SamplePreview sheet={sheet} />
          <div className="flex flex-wrap justify-between gap-2">
            <Button variant="secondary" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => reset()}>वापस · Back</Button>
            <Button loading={busy} disabled={missingRequired.length > 0} onClick={validate}>जाँचें · Validate {sheet.rows.length} rows</Button>
          </div>
        </Card>
      )}

      {step === "preview" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Valid" value={counts.valid} tone="green" icon={<CheckCircle2 className="h-5 w-5" />} />
            <StatCard label="Warnings" value={counts.warning} tone="gold" icon={<AlertTriangle className="h-5 w-5" />} />
            <StatCard label="Duplicates" value={counts.duplicate} tone="forest" icon={<Copy className="h-5 w-5" />} />
            <StatCard label="Errors" value={counts.error} tone="red" icon={<XCircle className="h-5 w-5" />} />
          </div>
          <Card className="p-3 sm:p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <Tabs<RowStatus | "all">
                value={filter}
                onChange={setFilter}
                className="mx-0 px-0"
                items={[
                  { value: "all", label: `All ${results.length}` },
                  { value: "warning", label: `⚠ ${counts.warning}` },
                  { value: "duplicate", label: `⧉ ${counts.duplicate}` },
                  { value: "error", label: `✕ ${counts.error}` },
                ]}
              />
              <span className="text-sm text-muted">{include.size} selected for import</span>
            </div>
            <PreviewTable kind={kind} results={results.filter((r) => filter === "all" || r.status === filter)} include={include} setInclude={setInclude} />
          </Card>
          <div className="flex flex-wrap justify-between gap-2">
            <Button variant="secondary" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => setStep("map")}>मैपिंग बदलें · Back to mapping</Button>
            <Button loading={busy} disabled={!include.size} onClick={() => setConfirm(true)}>{include.size} rows इम्पोर्ट करें · Import</Button>
          </div>
        </div>
      )}

      {step === "done" && summary && (
        <Card className="p-4 sm:p-6">
          <div className="mb-4 flex items-center gap-3">
            <CheckCircle2 className="h-8 w-8 text-leaf" />
            <div>
              <p className="font-hindi text-lg font-semibold text-forest">इम्पोर्ट पूरा हुआ · Import finished</p>
              <p className="text-sm text-muted">{fileName} · {sheet?.name}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Processed" value={summary.total} tone="forest" />
            <StatCard label="Imported" value={summary.imported} tone="green" />
            <StatCard label="Skipped" value={summary.skipped} tone="gold" />
            <StatCard label="Failed" value={summary.failed} tone="red" />
          </div>
          {summary.report.length > 0 && (
            <div className="mt-4">
              <ul className="max-h-60 space-y-1 overflow-y-auto rounded-xl bg-cream-100 p-3 text-sm">
                {summary.report.map((r, i) => (
                  <li key={i}><b>Row {String(r["Excel row"])}</b> · {String(r.Outcome)}: {String(r.Reason)}</li>
                ))}
              </ul>
              <Button className="mt-3" variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => downloadXlsx(`import-report-${summary.batchId.slice(0, 8)}.xlsx`, [{ name: "Report", rows: summary.report }])}>
                त्रुटि रिपोर्ट · Download error report
              </Button>
            </div>
          )}
          <Button className="mt-5" onClick={() => reset()}>नया इम्पोर्ट · Import another file</Button>
        </Card>
      )}

      <ImportHistory state={history} />

      <ConfirmDialog
        open={confirm}
        danger={false}
        title="इम्पोर्ट की पुष्टि करें · Confirm import"
        message={
          <>
            <p>{include.size} {kind === "members" ? "members" : "events"} will be saved.</p>
            {results.filter((r) => include.has(r.row) && r.status === "warning").length > 0 && (
              <p className="mt-2 text-gold-700">⚠ {results.filter((r) => include.has(r.row) && r.status === "warning").length} selected rows have warnings. {kind === "members" ? "Warnings are saved in the member's admin notes so you can correct them later." : ""}</p>
            )}
            {counts.error > 0 && <p className="mt-2 text-red-700">{counts.error} rows with errors will not be imported.</p>}
          </>
        }
        confirmLabel="इम्पोर्ट करें · Import"
        onConfirm={runImport}
        onCancel={() => setConfirm(false)}
      />
    </div>
  );
}

function Stepper({ step }: { step: Step }) {
  const steps: [Step, string][] = [["upload", "1 · फ़ाइल"], ["map", "2 · मिलान"], ["preview", "3 · जाँच"], ["done", "4 · सारांश"]];
  const idx = steps.findIndex(([s]) => s === step);
  return (
    <ol className="grid grid-cols-4 gap-1.5 text-center text-xs font-medium sm:text-sm">
      {steps.map(([s, l], i) => (
        <li key={s} className={clsx("rounded-full py-2 font-hindi", i < idx ? "bg-leaf-100 text-leaf-700" : i === idx ? "bg-forest text-white" : "bg-white text-muted")}>{l}</li>
      ))}
    </ol>
  );
}

function SamplePreview({ sheet }: { sheet: SheetData }) {
  const show = sheet.rows.slice(0, 3);
  const fmt = (v: unknown) => (v instanceof Date ? v.toDateString() : String(v ?? ""));
  return (
    <details className="rounded-xl bg-cream-100 p-3 text-sm">
      <summary className="cursor-pointer font-medium text-forest">फ़ाइल की पहली पंक्तियाँ · First rows of the file</summary>
      <div className="mt-2 overflow-x-auto">
        <table className="min-w-full text-left text-xs">
          <thead><tr>{sheet.headers.map((h) => <th key={h} className="whitespace-nowrap px-2 py-1 font-semibold">{h}</th>)}</tr></thead>
          <tbody>{show.map((r, i) => <tr key={i} className="border-t border-forest/5">{sheet.headers.map((h) => <td key={h} className="whitespace-nowrap px-2 py-1">{fmt(r[h])}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </details>
  );
}

const STATUS_BADGE: Record<RowStatus, { tone: "green" | "gold" | "grey" | "red"; label: string }> = {
  valid: { tone: "green", label: "✓ Valid" },
  warning: { tone: "gold", label: "⚠ Check" },
  duplicate: { tone: "grey", label: "⧉ Duplicate" },
  error: { tone: "red", label: "✕ Error" },
};

const dm = (d: number | null, m: number | null, y: number | null) => (d && m ? `${d} ${MONTHS_EN[m - 1].slice(0, 3)}${y ? ` ${y}` : ""}` : "—");

function PreviewTable({ kind, results, include, setInclude }: {
  kind: Kind; results: AnyResult[]; include: Set<number>; setInclude: (s: Set<number>) => void;
}) {
  if (!results.length) return <p className="py-6 text-center text-sm text-muted">No rows in this filter.</p>;
  const toggle = (row: number) => {
    const n = new Set(include);
    if (n.has(row)) n.delete(row);
    else n.add(row);
    setInclude(n);
  };
  const cols = kind === "members" ? ["Name", "Birthday", "Mobile", "Married", "Anniversary"] : ["Title", "Date", "Time", "Category", "Venue"];
  return (
    <div className="-mx-3 overflow-x-auto sm:mx-0">
      <table className="min-w-[760px] w-full text-left text-sm">
        <thead className="bg-cream-100 text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="w-12 px-3 py-2">Import</th>
            <th className="px-2 py-2">Row</th>
            <th className="px-2 py-2">Status</th>
            {cols.map((c) => <th key={c} className="px-2 py-2">{c}</th>)}
            <th className="px-2 py-2">Issues</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r) => {
            const md = kind === "members" ? (r.data as MemberDraft | null) : null;
            const ed = kind === "events" ? (r.data as EventDraft | null) : null;
            const b = STATUS_BADGE[r.status];
            return (
              <tr key={r.row} className={clsx("border-t border-forest/5 align-top", r.status === "error" && "bg-red-50/60")}>
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-[#4C956C]"
                    checked={include.has(r.row)}
                    disabled={r.status === "error"}
                    onChange={() => toggle(r.row)}
                    aria-label={`Include row ${r.row}`}
                  />
                </td>
                <td className="px-2 py-2 text-muted">{r.row}</td>
                <td className="px-2 py-2"><Badge tone={b.tone}>{b.label}</Badge></td>
                {md ? (
                  <>
                    <td className="px-2 py-2 font-medium">{md.full_name}</td>
                    <td className="px-2 py-2">{dm(md.birth_day, md.birth_month, md.birth_year)}</td>
                    <td className="px-2 py-2">{md.phone ?? <Missing />}</td>
                    <td className="px-2 py-2">{md.married === null ? "—" : md.married ? "हाँ" : "नहीं"}</td>
                    <td className="px-2 py-2">{dm(md.anniv_day, md.anniv_month, md.anniv_year)}</td>
                  </>
                ) : ed ? (
                  <>
                    <td className="px-2 py-2 font-medium">{ed.title}</td>
                    <td className="px-2 py-2">{ed.event_date}</td>
                    <td className="px-2 py-2">{ed.start_time ? formatTime(ed.start_time) : <Missing />}</td>
                    <td className="px-2 py-2">{EVENT_CATEGORIES[ed.category].en}</td>
                    <td className="px-2 py-2">{ed.venue ?? <Missing />}</td>
                  </>
                ) : (
                  <td colSpan={5} className="px-2 py-2 text-muted">—</td>
                )}
                <td className="px-2 py-2 text-xs">
                  {r.errors.map((e) => <p key={e} className="text-red-700">✕ {e}</p>)}
                  {r.duplicateOf && <p className="text-forest">⧉ {r.duplicateOf}</p>}
                  {r.warnings.map((w) => <p key={w} className="text-gold-700">⚠ {w}</p>)}
                  {r.missing.length > 0 && <p className="text-muted">Missing: {r.missing.join(", ")}</p>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Missing() {
  return <span className="rounded bg-gold-100 px-1.5 py-0.5 text-xs text-gold-700">missing</span>;
}

function ImportHistory({ state }: { state: { data: Batch[] | null; loading: boolean; error: string | null; reload: () => void } }) {
  return (
    <Card className="p-4 sm:p-5">
      <h3 className="mb-3 flex items-center gap-2 font-hindi text-lg font-semibold text-forest"><History className="h-5 w-5" /> इम्पोर्ट इतिहास · Import history</h3>
      {state.loading && !state.data ? <Loading /> : state.error ? <ErrorState message={state.error} onRetry={state.reload} /> : !state.data?.length ? (
        <p className="text-sm text-muted">No imports yet.</p>
      ) : (
        <div className="-mx-4 overflow-x-auto sm:mx-0">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-muted">
              <tr><th className="px-4 py-2">When</th><th className="px-2">Type</th><th className="px-2">File</th><th className="px-2">Rows</th><th className="px-2">Imported</th><th className="px-2">Skipped</th><th className="px-2">Failed</th><th className="px-2" /></tr>
            </thead>
            <tbody>
              {state.data.map((b) => (
                <tr key={b.id} className="border-t border-forest/5">
                  <td className="whitespace-nowrap px-4 py-2">{formatDateTime(b.created_at)}</td>
                  <td className="px-2">{b.kind}</td>
                  <td className="max-w-[12rem] truncate px-2" title={b.file_name}>{b.file_name}{b.sheet_name ? ` · ${b.sheet_name}` : ""}</td>
                  <td className="px-2">{b.total_rows}</td>
                  <td className="px-2 text-leaf-700">{b.imported}</td>
                  <td className="px-2 text-gold-700">{b.skipped}</td>
                  <td className="px-2 text-red-700">{b.failed}</td>
                  <td className="px-2">
                    {b.errors?.length > 0 && (
                      <Button size="sm" variant="ghost" icon={<Download className="h-4 w-4" />} onClick={() => downloadXlsx(`import-${b.created_at.slice(0, 10)}-errors.xlsx`, [{ name: "Errors", rows: b.errors.map((e) => ({ "Excel row": e.row, Reason: e.reason })) }])}>
                        Report
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
