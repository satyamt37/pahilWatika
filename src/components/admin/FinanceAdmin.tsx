"use client";
// Treasurer console. The database enforces every rule shown here: only treasurers
// may write, amounts/dates are frozen after saving, nothing can be deleted, and
// every change is written to fin_audit_log by trigger.
import { AlertTriangle, CheckCircle2, Download, FileUp, History, Pencil, Plus, Search, Undo2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { loadLedger } from "@/components/finance/FinanceSummary";
import { KindBadge, TxnDetails } from "@/components/finance/TxnParts";
import { useToast } from "@/components/toast";
import {
  Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, Input, Loading, Modal, Select, Tabs, Textarea, Toggle,
} from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { formatDate, formatDateTime, todayISO } from "@/lib/dates";
import {
  autoMap, detectDateOrder, downloadXlsx, isoFromParsed, parseAmount, parseDateCell, readWorkbook, str, type DateOrder, type FieldDef, type SheetData,
} from "@/lib/excel";
import { classifyKind, dupeKey, KIND_LABELS } from "@/lib/finance";
import { clsx, money } from "@/lib/format";
import { must, useLoad } from "@/lib/hooks";
import { fileExt, randomName, signedUrl } from "@/lib/storage";
import { supabase } from "@/lib/supabase";
import type { LedgerRow, TxnKind } from "@/lib/types";

type Sub = "add" | "ledger" | "rules" | "categories" | "audit" | "import";
type PayMethod = "cash" | "upi" | "bank" | "cheque" | "other";
const METHODS: { v: PayMethod; label: string }[] = [
  { v: "cash", label: "नकद · Cash" }, { v: "upi", label: "UPI" }, { v: "bank", label: "बैंक · Bank transfer" },
  { v: "cheque", label: "चेक · Cheque" }, { v: "other", label: "अन्य · Other" },
];

interface MemberOpt { id: string; full_name: string; status: string }
interface Category { id: string; kind: "income" | "expense"; name: string }

async function loadMembers(): Promise<MemberOpt[]> {
  // Treasurers read names through the privacy-filtered directory view.
  return must(await supabase.from("member_directory").select("id, full_name, status").order("full_name")) as MemberOpt[];
}
async function loadCategories(): Promise<Category[]> {
  return must(await supabase.from("fin_categories").select("*").order("kind").order("name")) as Category[];
}

export default function FinanceAdmin() {
  const a = useAuth();
  const [sub, setSub] = useState<Sub>("add");
  const members = useLoad(loadMembers, []);
  const cats = useLoad(loadCategories, []);
  const ledger = useLoad(loadLedger, []);

  if (!a.isTreasurer) {
    return <EmptyState title="अनुमति नहीं है" text="Only the treasurer or a super admin can manage Hisaab-Kitab." />;
  }

  return (
    <div className="space-y-5">
      <Card className="flex items-start gap-3 border-gold/30 bg-gold-100/40 p-4 text-sm">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-gold-700" />
        <p className="text-forest">
          प्रविष्टियाँ हटाई नहीं जा सकतीं। गलती होने पर “उलटें” (reverse) करके सही प्रविष्टि दोबारा दर्ज करें।
          <span className="block text-muted">Entries can never be deleted, and amount, type, date and member are locked once saved. To correct a mistake, reverse the entry and record it again. Every change is logged.</span>
        </p>
      </Card>

      <Tabs<Sub>
        value={sub}
        onChange={setSub}
        items={[
          { value: "add", label: "नई प्रविष्टि · Add entry" },
          { value: "ledger", label: "बही · Ledger" },
          { value: "rules", label: "अंशदान नियम · Rules" },
          { value: "categories", label: "श्रेणियाँ · Categories" },
          { value: "audit", label: "ऑडिट · Audit history" },
          { value: "import", label: "इम्पोर्ट · Import" },
        ]}
      />

      {sub === "add" && <AddEntry members={members.data ?? []} cats={cats.data ?? []} onSaved={ledger.reload} />}
      {sub === "ledger" && (ledger.error ? <ErrorState message={ledger.error} onRetry={ledger.reload} />
        : ledger.loading || !ledger.data ? <Loading /> : <Ledger rows={ledger.data} cats={cats.data ?? []} reload={ledger.reload} />)}
      {sub === "rules" && <Rules />}
      {sub === "categories" && <Categories cats={cats.data ?? []} reload={cats.reload} loading={cats.loading} />}
      {sub === "audit" && <Audit ledger={ledger.data ?? []} />}
      {sub === "import" && <Import members={members.data ?? []} ledger={ledger.data ?? []} onDone={ledger.reload} />}
    </div>
  );
}

// ------------------------------------------------------------------ receipts
async function uploadReceipt(file: File): Promise<string> {
  if (!/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(file.type)) throw new Error("Receipt must be a JPG, PNG, WEBP or PDF file");
  if (file.size > 10 * 1024 * 1024) throw new Error("Receipt must be smaller than 10 MB");
  const path = `${todayISO().slice(0, 4)}/${randomName(fileExt(file.name, file.type === "application/pdf" ? "pdf" : "jpg"))}`;
  const { error } = await supabase.storage.from("receipts").upload(path, file, { contentType: file.type });
  if (error) throw error;
  return path;
}

// ------------------------------------------------------------------ add entry
function AddEntry({ members, cats, onSaved }: { members: MemberOpt[]; cats: Category[]; onSaved: () => void }) {
  const toast = useToast();
  const today = todayISO();
  const blank = {
    kind: "contribution" as TxnKind, member_id: "", period: today.slice(0, 7), amount: "", txn_date: today,
    method: "upi" as PayMethod, reference_no: "", remarks: "", title: "", category: "", description: "", paid_by: "",
  };
  const [f, setF] = useState(blank);
  const [receipt, setReceipt] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (k: keyof typeof blank, v: string) => setF((x) => ({ ...x, [k]: v }));

  const catOptions = cats.filter((c) => (f.kind === "expense" ? c.kind === "expense" : c.kind === "income"));
  const active = members.filter((m) => m.status === "active");

  const validate = () => {
    const e: Record<string, string> = {};
    const amt = Number(f.amount);
    if (!f.amount || !Number.isFinite(amt) || amt <= 0) e.amount = "Enter an amount greater than 0";
    else if (Math.round(amt * 100) !== amt * 100) e.amount = "At most 2 decimal places";
    if (!f.txn_date) e.txn_date = "Date is required";
    else if (f.txn_date > today) e.txn_date = "Date cannot be in the future";
    if (f.kind === "contribution" && !f.member_id) e.member_id = "Choose the member";
    if (f.kind === "contribution" && !f.period) e.period = "Choose the month";
    if ((f.kind === "expense" || f.kind === "other_income") && !f.title.trim()) e.title = "Name is required";
    setErrors(e);
    return !Object.keys(e).length;
  };

  const save = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const receipt_path = receipt ? await uploadReceipt(receipt) : null;
      const row = {
        kind: f.kind,
        amount: Number(f.amount),
        txn_date: f.txn_date,
        period_month: f.kind === "contribution" ? `${f.period}-01` : null,
        member_id: f.kind === "contribution" ? f.member_id : null,
        title: f.kind === "contribution" ? null : f.kind === "opening_balance" ? (f.title.trim() || "Opening balance") : f.title.trim(),
        category: f.category || (f.kind === "contribution" ? "Monthly contribution" : null),
        description: f.description.trim() || null,
        payment_method: f.kind === "opening_balance" ? null : f.method,
        reference_no: f.reference_no.trim() || null,
        paid_by: f.kind === "expense" ? f.paid_by.trim() || null : null,
        receipt_path,
        remarks: f.remarks.trim() || null,
      };
      const { data, error } = await supabase.from("fin_transactions").insert(row).select("txn_no").single();
      if (error) throw error;
      toast.success(`प्रविष्टि #${data.txn_no} सहेजी गई · Entry saved`);
      setF({ ...blank, kind: f.kind, txn_date: f.txn_date, period: f.period, method: f.method });
      setReceipt(null);
      if (fileRef.current) fileRef.current.value = "";
      onSaved();
    } catch (e) {
      toast.error(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-4 sm:p-6">
      <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(Object.keys(KIND_LABELS) as TxnKind[]).map((k) => (
          <button
            key={k}
            onClick={() => { set("kind", k); setErrors({}); }}
            className={clsx("rounded-xl border px-3 py-3 text-sm font-medium transition-colors",
              f.kind === k ? "border-forest bg-forest text-white" : "border-forest/15 bg-white text-forest hover:bg-cream-100")}
          >
            <span className="block font-hindi">{KIND_LABELS[k].hi}</span>
            <span className="block text-xs opacity-75">{KIND_LABELS[k].en}</span>
          </button>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {f.kind === "contribution" && (
          <>
            <Field label="सदस्य · Member" required error={errors.member_id}>
              <Select value={f.member_id} onChange={(e) => set("member_id", e.target.value)}>
                <option value="">— चुनें · Select —</option>
                {active.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
              </Select>
            </Field>
            <Field label="किस माह का · For month" required error={errors.period}>
              <Input type="month" value={f.period} onChange={(e) => set("period", e.target.value)} />
            </Field>
          </>
        )}
        {f.kind !== "contribution" && (
          <Field label={f.kind === "expense" ? "खर्च का नाम · Expense name" : f.kind === "other_income" ? "आय का स्रोत · Income source" : "विवरण · Label"} required={f.kind !== "opening_balance"} error={errors.title}>
            <Input value={f.title} onChange={(e) => set("title", e.target.value)} maxLength={150} placeholder={f.kind === "expense" ? "e.g. Chai-chappa, 3 Nov" : ""} />
          </Field>
        )}
        <Field label="राशि (₹) · Amount" required error={errors.amount}>
          <Input inputMode="decimal" type="number" min="0.01" step="0.01" value={f.amount} onChange={(e) => set("amount", e.target.value)} />
        </Field>
        <Field label="दिनांक · Date" required error={errors.txn_date}>
          <Input type="date" max={today} value={f.txn_date} onChange={(e) => set("txn_date", e.target.value)} />
        </Field>
        {f.kind !== "opening_balance" && (
          <Field label="भुगतान का तरीका · Payment method">
            <Select value={f.method} onChange={(e) => set("method", e.target.value)}>
              {METHODS.map((m) => <option key={m.v} value={m.v}>{m.label}</option>)}
            </Select>
          </Field>
        )}
        <Field label="श्रेणी · Category">
          <Select value={f.category} onChange={(e) => set("category", e.target.value)}>
            <option value="">—</option>
            {catOptions.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="संदर्भ संख्या · Reference no." hint="UPI / cheque / bank reference">
          <Input value={f.reference_no} onChange={(e) => set("reference_no", e.target.value)} maxLength={80} />
        </Field>
        {f.kind === "expense" && (
          <>
            <Field label="भुगतान किसने किया · Paid by">
              <Input value={f.paid_by} onChange={(e) => set("paid_by", e.target.value)} maxLength={100} />
            </Field>
            <Field label="रसीद · Receipt" hint="JPG, PNG, WEBP or PDF, up to 10 MB">
              <Input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="py-2" onChange={(e) => setReceipt(e.target.files?.[0] ?? null)} />
            </Field>
          </>
        )}
        <Field label="विवरण · Description" className="sm:col-span-2">
          <Textarea value={f.description} onChange={(e) => set("description", e.target.value)} maxLength={1000} className="min-h-[72px]" />
        </Field>
        <Field label="टिप्पणी · Remarks" className="sm:col-span-2">
          <Input value={f.remarks} onChange={(e) => set("remarks", e.target.value)} maxLength={300} />
        </Field>
      </div>
      <div className="mt-5 flex justify-end">
        <Button onClick={save} loading={saving} icon={<Plus className="h-4 w-4" />} size="lg">सहेजें · Save entry</Button>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ ledger
function Ledger({ rows, cats, reload }: { rows: LedgerRow[]; cats: Category[]; reload: () => void }) {
  const toast = useToast();
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(40);
  const [edit, setEdit] = useState<LedgerRow | null>(null);
  const [reverse, setReverse] = useState<LedgerRow | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => [String(r.txn_no), r.title, r.member_name, r.description, r.remarks, r.category, r.reference_no, r.txn_date]
      .some((v) => v?.toLowerCase().includes(s)));
  }, [rows, q]);

  const doReverse = async () => {
    if (!reverse) return;
    if (!reason.trim()) return toast.error("कारण लिखें · Please enter a reason");
    setBusy(true);
    try {
      const { error } = await supabase.rpc("fin_reverse", { p_txn: reverse.id, p_reason: reason.trim() });
      if (error) throw error;
      toast.success(`#${reverse.txn_no} उलटी गई · Entry reversed`);
      setReverse(null);
      setReason("");
      reload();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted" />
        <Input className="pl-9" placeholder="# / नाम / विवरण खोजें · Search" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {!filtered.length ? (
        <EmptyState title="कोई प्रविष्टि नहीं" text={rows.length ? "No entries match your search." : "No transactions yet. Add the first entry from the “Add entry” tab."} />
      ) : (
        <div className="space-y-2.5">
          {filtered.slice(0, limit).map((r) => (
            <Card key={r.id} className="p-3.5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <span className="font-semibold text-forest">#{r.txn_no}</span>
                    <span>{formatDate(r.txn_date)}</span>
                    <KindBadge kind={r.kind} />
                    {r.updated_at && <span>edited {formatDateTime(r.updated_at)}</span>}
                  </div>
                  <TxnDetails r={r} onReceipt={async (p) => { const u = await signedUrl("receipts", p); if (u) window.open(u, "_blank", "noopener"); }} />
                </div>
                <div className="flex items-center justify-between gap-2 sm:flex-col sm:items-end">
                  <span className={clsx("font-semibold", r.signed_amount < 0 ? "text-red-700" : "text-leaf-700", r.is_reversed && "line-through opacity-60")}>
                    {r.signed_amount < 0 ? "−" : "+"}{money(Math.abs(r.signed_amount))}
                  </span>
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="secondary" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEdit(r)}>Edit</Button>
                    {!r.is_reversal && !r.is_reversed && (
                      <Button size="sm" variant="secondary" className="text-red-700" icon={<Undo2 className="h-3.5 w-3.5" />} onClick={() => { setReverse(r); setReason(""); }}>
                        Reverse
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          ))}
          {filtered.length > limit && <div className="text-center"><Button variant="secondary" onClick={() => setLimit((l) => l + 40)}>और दिखाएँ · Show more</Button></div>}
        </div>
      )}

      {edit && <EditTxn row={edit} cats={cats} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}

      <ConfirmDialog
        open={!!reverse}
        title={`प्रविष्टि #${reverse?.txn_no ?? ""} उलटें · Reverse entry`}
        message={
          <div className="space-y-2">
            <p>
              A reversal entry of <b>{money(reverse?.amount)}</b> dated today will be added so that this entry no longer counts in any balance.
              The original stays in the ledger for audit. If the amount was wrong, add the correct entry afterwards.
            </p>
          </div>
        }
        confirmLabel="उलटें · Reverse"
        loading={busy}
        onConfirm={doReverse}
        onCancel={() => setReverse(null)}
      >
        <Field label="कारण · Reason" required className="mt-4">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="e.g. Wrong amount entered" />
        </Field>
      </ConfirmDialog>
    </div>
  );
}

function EditTxn({ row, cats, onClose, onSaved }: { row: LedgerRow; cats: Category[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({
    title: row.title ?? "", category: row.category ?? "", description: row.description ?? "", remarks: row.remarks ?? "",
    reference_no: row.reference_no ?? "", paid_by: row.paid_by ?? "", payment_method: row.payment_method ?? "",
  });
  const [receipt, setReceipt] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const catOptions = cats.filter((c) => (row.kind === "expense" ? c.kind === "expense" : c.kind === "income"));

  const save = async () => {
    setSaving(true);
    try {
      const patch: Record<string, unknown> = {
        title: row.kind === "contribution" ? row.title : f.title.trim() || null,
        category: f.category || null,
        description: f.description.trim() || null,
        remarks: f.remarks.trim() || null,
        reference_no: f.reference_no.trim() || null,
        paid_by: f.paid_by.trim() || null,
        payment_method: f.payment_method || null,
      };
      if (receipt) patch.receipt_path = await uploadReceipt(receipt);
      const { error } = await supabase.from("fin_transactions").update(patch).eq("id", row.id);
      if (error) throw error;
      toast.success("बदलाव सहेजे गए · Changes saved (logged in audit history)");
      onSaved();
    } catch (e) {
      toast.error(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`प्रविष्टि #${row.txn_no} संपादित करें · Edit details`}
      footer={<><Button variant="secondary" onClick={onClose}>रद्द · Cancel</Button><Button onClick={save} loading={saving}>सहेजें · Save</Button></>}
    >
      <div className="mb-4 rounded-xl bg-cream-200/60 p-3 text-sm">
        <p className="font-medium text-forest">{KIND_LABELS[row.kind].en} · {money(row.amount)} · {formatDate(row.txn_date)}{row.member_name ? ` · ${row.member_name}` : ""}</p>
        <p className="text-xs text-muted">Amount, type, date and member are locked. To change them, reverse this entry and add a new one.</p>
      </div>
      <div className="grid gap-3">
        {row.kind !== "contribution" && <Field label="नाम · Name"><Input value={f.title} onChange={(e) => set("title", e.target.value)} maxLength={150} /></Field>}
        <Field label="श्रेणी · Category">
          <Select value={f.category} onChange={(e) => set("category", e.target.value)}>
            <option value="">—</option>
            {f.category && !catOptions.some((c) => c.name === f.category) && <option value={f.category}>{f.category}</option>}
            {catOptions.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
          </Select>
        </Field>
        {row.kind !== "opening_balance" && (
          <Field label="भुगतान का तरीका · Payment method">
            <Select value={f.payment_method} onChange={(e) => set("payment_method", e.target.value)}>
              <option value="">—</option>
              {METHODS.map((m) => <option key={m.v} value={m.v}>{m.label}</option>)}
            </Select>
          </Field>
        )}
        <Field label="संदर्भ संख्या · Reference no."><Input value={f.reference_no} onChange={(e) => set("reference_no", e.target.value)} maxLength={80} /></Field>
        {row.kind === "expense" && <Field label="भुगतान किसने किया · Paid by"><Input value={f.paid_by} onChange={(e) => set("paid_by", e.target.value)} maxLength={100} /></Field>}
        <Field label="विवरण · Description"><Textarea value={f.description} onChange={(e) => set("description", e.target.value)} maxLength={1000} className="min-h-[72px]" /></Field>
        <Field label="टिप्पणी · Remarks"><Input value={f.remarks} onChange={(e) => set("remarks", e.target.value)} maxLength={300} /></Field>
        <Field label={row.receipt_path ? "रसीद बदलें · Replace receipt" : "रसीद जोड़ें · Attach receipt"} hint="JPG, PNG, WEBP or PDF, up to 10 MB">
          <Input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="py-2" onChange={(e) => setReceipt(e.target.files?.[0] ?? null)} />
        </Field>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ contribution rules
interface Rule { id: string; name: string; amount: number; frequency: "monthly" | "one_time"; effective_from: string; effective_to: string | null; active: boolean; created_at: string }

function Rules() {
  const toast = useToast();
  const rules = useLoad(async () => must(await supabase.from("fin_contribution_rules").select("*").order("effective_from", { ascending: false })) as Rule[], []);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "Monthly contribution", amount: "", frequency: "monthly", effective_from: `${todayISO().slice(0, 7)}`, effective_to: "" });
  const [saving, setSaving] = useState(false);
  const [ending, setEnding] = useState<Rule | null>(null);

  const add = async () => {
    const amt = Number(f.amount);
    if (!f.name.trim() || !Number.isFinite(amt) || amt <= 0 || !f.effective_from) return toast.error("Name, amount and start month are required");
    if (f.effective_to && f.effective_to < f.effective_from) return toast.error("End month must be after start month");
    setSaving(true);
    try {
      const { error } = await supabase.from("fin_contribution_rules").insert({
        name: f.name.trim(), amount: amt, frequency: f.frequency,
        effective_from: `${f.effective_from}-01`, effective_to: f.effective_to ? `${f.effective_to}-01` : null,
      });
      if (error) throw error;
      toast.success("नियम जोड़ा गया · Rule added");
      setOpen(false);
      rules.reload();
    } catch (e) {
      toast.error(e);
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async () => {
    if (!ending) return;
    setSaving(true);
    try {
      const { error } = await supabase.from("fin_contribution_rules").update({ active: false }).eq("id", ending.id);
      if (error) throw error;
      toast.success("नियम निष्क्रिय · Rule deactivated");
      setEnding(null);
      rules.reload();
    } catch (e) {
      toast.error(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="flex flex-col gap-3 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
        <p className="text-muted">
          Rules decide the expected monthly contribution used for “pending” amounts. The amount is never assumed — set it here, and add a new rule when it changes (e.g. from a new month).
        </p>
        <Button onClick={() => setOpen(true)} icon={<Plus className="h-4 w-4" />} className="shrink-0">नया नियम · New rule</Button>
      </Card>
      {rules.error ? <ErrorState message={rules.error} onRetry={rules.reload} /> : rules.loading ? <Loading /> : !rules.data?.length ? (
        <EmptyState title="कोई नियम नहीं" text="No contribution rule yet, so no amounts are shown as pending." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {rules.data.map((r) => (
            <Card key={r.id} className={clsx("p-4", !r.active && "opacity-60")}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-forest">{r.name}</p>
                  <p className="text-2xl font-bold text-leaf-700">{money(r.amount)} <span className="text-sm font-normal text-muted">/ {r.frequency === "monthly" ? "month" : "once"}</span></p>
                  <p className="text-xs text-muted">From {formatDate(r.effective_from, { month: "short", year: "numeric" })}{r.effective_to ? ` to ${formatDate(r.effective_to, { month: "short", year: "numeric" })}` : " onwards"}</p>
                </div>
                {r.active ? <Badge>Active</Badge> : <Badge tone="grey">Inactive</Badge>}
              </div>
              {r.active && <Button size="sm" variant="secondary" className="mt-3" onClick={() => setEnding(r)}>निष्क्रिय करें · Deactivate</Button>}
            </Card>
          ))}
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="नया अंशदान नियम · New contribution rule"
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>रद्द · Cancel</Button><Button onClick={add} loading={saving}>सहेजें · Save</Button></>}>
        <div className="grid gap-3">
          <Field label="नाम · Name" required><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="राशि (₹) · Amount per member" required><Input type="number" min="1" step="0.01" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label="आवृत्ति · Frequency">
            <Select value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value })}>
              <option value="monthly">मासिक · Monthly</option>
              <option value="one_time">एक बार · One time</option>
            </Select>
          </Field>
          <Field label="कब से · From month" required><Input type="month" value={f.effective_from} onChange={(e) => setF({ ...f, effective_from: e.target.value })} /></Field>
          <Field label="कब तक · Until month" hint="Leave empty if it continues"><Input type="month" value={f.effective_to} onChange={(e) => setF({ ...f, effective_to: e.target.value })} /></Field>
        </div>
      </Modal>
      <ConfirmDialog open={!!ending} title="नियम निष्क्रिय करें · Deactivate rule" danger={false} loading={saving}
        message={`“${ending?.name}” (${money(ending?.amount)}) will stop counting towards pending contributions. Recorded payments are not affected.`}
        onConfirm={deactivate} onCancel={() => setEnding(null)} />
    </div>
  );
}

// ------------------------------------------------------------------ categories
function Categories({ cats, reload, loading }: { cats: Category[]; reload: () => void; loading: boolean }) {
  const toast = useToast();
  const [kind, setKind] = useState<"income" | "expense">("expense");
  const [name, setName] = useState("");
  const [del, setDel] = useState<Category | null>(null);
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const { error } = await supabase.from("fin_categories").insert({ kind, name: name.trim() });
      if (error) throw error;
      setName("");
      toast.success("श्रेणी जोड़ी गई · Category added");
      reload();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!del) return;
    setBusy(true);
    try {
      const { error } = await supabase.from("fin_categories").delete().eq("id", del.id);
      if (error) throw error;
      toast.success("श्रेणी हटाई गई · Category removed");
      setDel(null);
      reload();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading />;
  return (
    <div className="space-y-4">
      <Card className="flex flex-col gap-2 p-4 sm:flex-row">
        <Select value={kind} onChange={(e) => setKind(e.target.value as "income" | "expense")} className="sm:w-44">
          <option value="expense">खर्च · Expense</option>
          <option value="income">आय · Income</option>
        </Select>
        <Input placeholder="नई श्रेणी · New category" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} onKeyDown={(e) => e.key === "Enter" && add()} />
        <Button onClick={add} loading={busy} icon={<Plus className="h-4 w-4" />}>जोड़ें · Add</Button>
      </Card>
      <div className="grid gap-4 sm:grid-cols-2">
        {(["expense", "income"] as const).map((k) => (
          <Card key={k} className="p-4">
            <p className="mb-2 font-hindi font-semibold text-forest">{k === "expense" ? "खर्च · Expense" : "आय · Income"}</p>
            <ul className="divide-y divide-forest/5">
              {cats.filter((c) => c.kind === k).map((c) => (
                <li key={c.id} className="flex items-center justify-between py-2 text-sm">
                  <span>{c.name}</span>
                  <button className="text-xs text-red-700 hover:underline" onClick={() => setDel(c)}>हटाएँ · Remove</button>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
      <ConfirmDialog open={!!del} title="श्रेणी हटाएँ · Remove category" loading={busy}
        message={`Remove “${del?.name}” from the list? Existing entries keep their category text.`}
        onConfirm={remove} onCancel={() => setDel(null)} />
    </div>
  );
}

// ------------------------------------------------------------------ audit
interface AuditRow {
  id: number; txn_id: string; action: "insert" | "update" | "reverse";
  old_values: Record<string, unknown> | null; new_values: Record<string, unknown> | null;
  changed_by: string | null; changed_at: string;
}
const SKIP_DIFF = new Set(["updated_at", "updated_by", "created_at", "created_by", "id", "txn_no"]);

function Audit({ ledger }: { ledger: LedgerRow[] }) {
  const [txnNo, setTxnNo] = useState("");
  const [limit, setLimit] = useState(50);
  const txnId = txnNo ? ledger.find((r) => String(r.txn_no) === txnNo.trim())?.id ?? "none" : null;
  const data = useLoad(async () => {
    let q = supabase.from("fin_audit_log").select("*").order("changed_at", { ascending: false }).limit(limit);
    if (txnId) q = q.eq("txn_id", txnId);
    const rows = must(await q) as AuditRow[];
    const ids = [...new Set(rows.map((r) => r.changed_by).filter(Boolean))] as string[];
    const names = ids.length ? (must(await supabase.from("user_names").select("id, name").in("id", ids)) as { id: string; name: string }[]) : [];
    return { rows, names: new Map(names.map((n) => [n.id, n.name])) };
  }, [txnId, limit]);
  const noById = useMemo(() => new Map(ledger.map((r) => [r.id, r.txn_no])), [ledger]);

  return (
    <div className="space-y-3">
      <div className="flex max-w-sm items-center gap-2">
        <History className="h-5 w-5 text-muted" />
        <Input placeholder="प्रविष्टि # से छाँटें · Filter by entry #" inputMode="numeric" value={txnNo} onChange={(e) => setTxnNo(e.target.value.replace(/\D/g, ""))} />
      </div>
      {data.error ? <ErrorState message={data.error} onRetry={data.reload} /> : data.loading || !data.data ? <Loading /> : !data.data.rows.length ? (
        <EmptyState title="कोई रिकॉर्ड नहीं" text={txnId === "none" ? "No entry with that number." : "No audit records yet."} />
      ) : (
        <div className="space-y-2.5">
          {data.data.rows.map((r) => {
            const nv = r.new_values ?? {};
            const ov = r.old_values ?? {};
            const changed = r.action === "update" ? Object.keys(nv).filter((k) => !SKIP_DIFF.has(k) && JSON.stringify(nv[k]) !== JSON.stringify(ov[k])) : [];
            return (
              <Card key={r.id} className="p-3.5 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={r.action === "insert" ? "green" : r.action === "reverse" ? "gold" : "grey"}>{r.action}</Badge>
                  <span className="font-semibold text-forest">#{noById.get(r.txn_id) ?? String(nv.txn_no ?? "?")}</span>
                  <span className="text-muted">{formatDateTime(r.changed_at)}</span>
                  <span className="text-muted">· {r.changed_by ? data.data!.names.get(r.changed_by) ?? "User" : "System"}</span>
                </div>
                {r.action !== "update" ? (
                  <p className="mt-1 text-muted">
                    {KIND_LABELS[nv.kind as TxnKind]?.en ?? String(nv.kind)} · {money(nv.amount as number)} · {String(nv.txn_date)}
                    {nv.reversal_reason ? ` · Reason: ${String(nv.reversal_reason)}` : ""}
                  </p>
                ) : changed.length ? (
                  <ul className="mt-1.5 space-y-0.5">
                    {changed.map((k) => (
                      <li key={k} className="break-words text-xs">
                        <span className="font-medium text-forest">{k}</span>: <span className="text-red-700 line-through">{String(ov[k] ?? "∅")}</span> → <span className="text-leaf-700">{String(nv[k] ?? "∅")}</span>
                      </li>
                    ))}
                  </ul>
                ) : <p className="mt-1 text-xs text-muted">No visible field changes.</p>}
              </Card>
            );
          })}
          {data.data.rows.length >= limit && <div className="text-center"><Button variant="secondary" onClick={() => setLimit((l) => l + 50)}>और दिखाएँ · Show more</Button></div>}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ import
const IMPORT_FIELDS: FieldDef[] = [
  { key: "date", label: "Date", required: true, synonyms: ["txn date", "transaction date", "date__c", "दिनांक", "तारीख", "created date"] },
  { key: "amount", label: "Amount", synonyms: ["amount__c", "राशि", "रकम", "value"] },
  { key: "credit", label: "Credit amount", synonyms: ["credit", "credit__c", "जमा", "received"] },
  { key: "debit", label: "Debit amount", synonyms: ["debit", "debit__c", "नामे", "spent", "खर्च"] },
  { key: "type", label: "Type (credit/debit)", synonyms: ["type__c", "transaction type", "credit/debit", "credit_debit__c", "प्रकार", "category type"] },
  { key: "member", label: "Member name", synonyms: ["member", "name", "member name", "member__c", "नाम", "सदस्य", "contributor"] },
  { key: "title", label: "Item / description", synonyms: ["description", "description__c", "particulars", "item", "विवरण", "title", "purpose"] },
  { key: "category", label: "Category", synonyms: ["category__c", "श्रेणी", "head"] },
  { key: "method", label: "Payment method", synonyms: ["mode", "payment mode", "method", "payment_method__c"] },
  { key: "reference", label: "Reference no.", synonyms: ["reference", "ref", "utr", "transaction id", "reference__c"] },
  { key: "period", label: "For month", synonyms: ["month", "period", "for month", "माह"] },
  { key: "external", label: "Record ID (Salesforce Id)", synonyms: ["id", "record id", "salesforce id", "credit debit id", "credit_debit__c id"] },
];

interface Prepared {
  row: number;
  status: "ok" | "duplicate" | "error";
  errors: string[];
  raw: Record<string, unknown>;
  rec?: {
    kind: TxnKind; amount: number; txn_date: string; period_month: string | null; member_id: string | null;
    title: string | null; category: string | null; description: string | null; payment_method: PayMethod | null;
    reference_no: string | null; external_ref: string | null; remarks: string | null;
  };
  memberName?: string | null;
}

const normName = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
function toMethod(v: unknown): PayMethod | null {
  const s = String(v ?? "").toLowerCase();
  if (!s.trim()) return null;
  if (/upi|gpay|phonepe|paytm|google pay/.test(s)) return "upi";
  if (/cash|नकद/.test(s)) return "cash";
  if (/bank|neft|imps|rtgs|transfer/.test(s)) return "bank";
  if (/cheque|check/.test(s)) return "cheque";
  return "other";
}

function Import({ members, ledger, onDone }: { members: MemberOpt[]; ledger: LedgerRow[]; onDone: () => void }) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [sheets, setSheets] = useState<SheetData[]>([]);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [map, setMap] = useState<Record<string, string>>({});
  const [order, setOrder] = useState<DateOrder>("dmy");
  const [source, setSource] = useState<"salesforce_import" | "excel_import">("salesforce_import");
  const [unmatchedAsIncome, setUnmatchedAsIncome] = useState(false);
  const [approved, setApproved] = useState(false);
  const [reading, setReading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ total: number; imported: number; skipped: number; failed: number; report: Prepared[] } | null>(null);
  const sheet = sheets[sheetIdx];

  const pickFile = async (f: File | null) => {
    setResult(null);
    setFile(f);
    setSheets([]);
    if (!f) return;
    if (f.size > 15 * 1024 * 1024) return toast.error("File is larger than 15 MB");
    setReading(true);
    try {
      const s = (await readWorkbook(f)).filter((x) => x.rows.length);
      if (!s.length) throw new Error("No data rows found in this workbook");
      setSheets(s);
      selectSheet(s, 0);
      if (/salesforce|credit.?debit|report/i.test(f.name)) setSource("salesforce_import");
    } catch (e) {
      toast.error(e);
    } finally {
      setReading(false);
    }
  };
  const selectSheet = (s: SheetData[], i: number) => {
    setSheetIdx(i);
    const m = autoMap(s[i].headers, IMPORT_FIELDS);
    setMap(m);
    setOrder(detectDateOrder(s[i].rows.map((r) => (m.date ? r[m.date] : null))));
  };

  const prepared = useMemo<Prepared[]>(() => {
    if (!sheet) return [];
    const byName = new Map(members.map((m) => [normName(m.full_name), m.id]));
    const existingExt = new Set(ledger.filter((r) => r.external_ref).map((r) => `${r.source}|${r.external_ref}`));
    const existingKeys = new Set(ledger.filter((r) => !r.is_reversal && !r.is_reversed).map((r) => dupeKey({ ...r, amount: r.amount })));
    const seenExt = new Set<string>();
    const seenKeys = new Set<string>();
    const get = (r: Record<string, unknown>, k: string) => (map[k] ? r[map[k]] : null);

    return sheet.rows.map((raw) => {
      const errors: string[] = [];
      const row = raw.__row as number;
      // date
      let txn_date: string | null = null;
      try {
        const p = parseDateCell(get(raw, "date"), order);
        if (!p) errors.push("Date is missing");
        else if (p.y === null) errors.push("Date has no year");
        else txn_date = isoFromParsed(p);
      } catch (e) {
        errors.push((e as Error).message);
      }
      if (txn_date && txn_date > todayISO()) errors.push("Date is in the future");
      // amount & direction
      let amount: number | null = null;
      let sign = 0;
      try {
        if (map.amount) {
          amount = parseAmount(get(raw, "amount"));
          if (amount !== null) sign = Math.sign(amount);
        }
        if (amount === null && (map.credit || map.debit)) {
          const c = parseAmount(get(raw, "credit"));
          const d = parseAmount(get(raw, "debit"));
          if (c && d) errors.push("Both credit and debit amounts are filled");
          else if (c) { amount = c; sign = 1; }
          else if (d) { amount = d; sign = -1; }
        }
      } catch (e) {
        errors.push((e as Error).message);
      }
      if (amount === null || amount === 0) errors.push("Amount is missing or zero");
      let kind = classifyKind(get(raw, "type"), sign || undefined);
      if (!kind) errors.push("Cannot tell whether this is a credit or a debit");
      // member
      const memberName = str(get(raw, "member"));
      let member_id: string | null = null;
      if (memberName) member_id = byName.get(normName(memberName)) ?? null;
      if (kind === "contribution" && !member_id) {
        if (unmatchedAsIncome) kind = "other_income";
        else errors.push(memberName ? `Member “${memberName}” not found in the directory` : "Member name is missing for a contribution");
      }
      // period
      let period_month: string | null = null;
      if (kind === "contribution" && map.period && str(get(raw, "period"))) {
        try {
          const p = parseDateCell(get(raw, "period"), order);
          if (p?.y) period_month = `${p.y}-${String(p.m).padStart(2, "0")}-01`;
          else if (p) errors.push("“For month” needs a year");
        } catch {
          const s = String(get(raw, "period"));
          const m = /^(\d{4})-(\d{1,2})$/.exec(s.trim());
          if (m) period_month = `${m[1]}-${m[2].padStart(2, "0")}-01`;
          else errors.push(`Cannot read month “${s}”`);
        }
      }
      const title = str(get(raw, "title"));
      const external_ref = str(get(raw, "external"));
      if (kind === "contribution" && member_id === null && !errors.length) errors.push("Member missing");

      const rec = !errors.length && kind && amount && txn_date ? {
        kind, amount: Math.abs(amount), txn_date, period_month, member_id: kind === "contribution" ? member_id : null,
        title: kind === "contribution" ? null : (title ?? memberName ?? (kind === "expense" ? "Imported expense" : "Imported income")),
        category: str(get(raw, "category")), description: kind === "contribution" ? title : null,
        payment_method: toMethod(get(raw, "method")), reference_no: str(get(raw, "reference")), external_ref,
        remarks: kind === "other_income" && memberName && !member_id ? `From: ${memberName}` : null,
      } : undefined;

      let status: Prepared["status"] = errors.length ? "error" : "ok";
      if (rec) {
        const extKey = external_ref ? `${source}|${external_ref}` : null;
        const key = dupeKey(rec);
        if ((extKey && (existingExt.has(extKey) || seenExt.has(extKey))) || existingKeys.has(key) || seenKeys.has(key)) {
          status = "duplicate";
          errors.push(extKey && (existingExt.has(extKey) || seenExt.has(extKey)) ? "Record ID already imported" : "Same date, amount and party already exist");
        }
        if (extKey) seenExt.add(extKey);
        seenKeys.add(key);
      }
      return { row, status, errors, raw, rec: status === "ok" ? rec : undefined, memberName };
    });
  }, [sheet, map, order, members, ledger, source, unmatchedAsIncome]);

  const counts = {
    ok: prepared.filter((p) => p.status === "ok").length,
    dup: prepared.filter((p) => p.status === "duplicate").length,
    err: prepared.filter((p) => p.status === "error").length,
  };
  const valid = prepared.filter((p) => p.status === "ok");
  const totalValid = valid.reduce((s, p) => s + (p.rec!.kind === "expense" ? -p.rec!.amount : p.rec!.amount), 0);

  const downloadReport = (rows: Prepared[]) =>
    downloadXlsx(`hisaab-import-report-${todayISO()}.xlsx`, [{
      name: "Import report",
      rows: rows.map((p) => ({ "Excel row": p.row, Status: p.status, Problems: p.errors.join("; "), ...Object.fromEntries(Object.entries(p.raw).filter(([k]) => k !== "__row")) })),
    }]);

  const runImport = async () => {
    if (!file || !sheet || !valid.length || !approved) return;
    setImporting(true);
    try {
      const { data: batch, error } = await supabase.from("import_batches").insert({
        kind: "transactions", file_name: file.name, sheet_name: sheet.name, total_rows: prepared.length, mapping: { ...map, order, source },
      }).select("id").single();
      if (error) throw error;
      const report = prepared.map((p) => ({ ...p }));
      let imported = 0;
      let failed = 0;
      const chunk = 100;
      for (let i = 0; i < valid.length; i += chunk) {
        const part = valid.slice(i, i + chunk);
        const { error: e2 } = await supabase.from("fin_transactions").insert(part.map((p) => ({ ...p.rec, source, import_batch_id: batch.id })));
        if (e2) {
          // Retry one by one so a single bad row does not sink the whole chunk.
          for (const p of part) {
            const { error: e3 } = await supabase.from("fin_transactions").insert({ ...p.rec, source, import_batch_id: batch.id });
            const target = report.find((x) => x.row === p.row)!;
            if (e3) { failed++; target.status = "error"; target.errors = [e3.message]; } else imported++;
          }
        } else imported += part.length;
      }
      const skipped = counts.dup;
      const errorRows = report.filter((p) => p.status !== "ok").map((p) => ({ row: p.row, status: p.status, errors: p.errors }));
      await supabase.from("import_batches").update({ imported, skipped, failed: failed + counts.err, errors: errorRows }).eq("id", batch.id);
      setResult({ total: prepared.length, imported, skipped, failed: failed + counts.err, report });
      toast.success(`${imported} प्रविष्टियाँ इम्पोर्ट हुईं · entries imported`);
      onDone();
    } catch (e) {
      toast.error(e);
    } finally {
      setImporting(false);
    }
  };

  if (result) {
    return (
      <Card className="p-5">
        <div className="flex items-center gap-2 text-forest"><CheckCircle2 className="h-6 w-6 text-leaf" /><p className="font-hindi text-lg font-semibold">इम्पोर्ट पूर्ण · Import finished</p></div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Processed" v={result.total} /><Stat label="Imported" v={result.imported} tone="text-leaf-700" />
          <Stat label="Skipped (duplicates)" v={result.skipped} tone="text-gold-700" /><Stat label="Failed" v={result.failed} tone="text-red-700" />
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => downloadReport(result.report)}>रिपोर्ट डाउनलोड · Download report</Button>
          <Button onClick={() => { setResult(null); setFile(null); setSheets([]); setApproved(false); }}>नया इम्पोर्ट · New import</Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="flex items-start gap-3 border-red-200 bg-red-50 p-4 text-sm">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-700" />
        <div className="text-red-900">
          <p className="font-semibold">केवल स्वामी की स्वीकृति के बाद · Only with the owner&apos;s approval</p>
          <p>
            Nothing is migrated automatically. Export the records from the existing Salesforce Hisaab-Kitab (a report of Credit_Debit__c, saved as Excel/CSV) or any spreadsheet,
            review the preview below, and import only after the owner has approved. Imported rows are tagged with their source and batch, and can be corrected with reversals.
          </p>
        </div>
      </Card>

      <Card className="p-4 sm:p-5">
        <Field label="1. फ़ाइल चुनें · Choose file" hint=".xlsx, .xls or .csv — up to 15 MB">
          <Input type="file" accept=".xlsx,.xls,.csv" className="py-2" onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
        </Field>
        {reading && <Loading label="फ़ाइल पढ़ी जा रही है · Reading workbook…" />}
      </Card>

      {sheet && (
        <>
          <Card className="space-y-4 p-4 sm:p-5">
            <p className="font-hindi font-semibold text-forest">2. शीट और कॉलम · Sheet and columns</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="शीट · Sheet">
                <Select value={sheetIdx} onChange={(e) => selectSheet(sheets, Number(e.target.value))}>
                  {sheets.map((s, i) => <option key={s.name} value={i}>{s.name} ({s.rows.length} rows)</option>)}
                </Select>
              </Field>
              <Field label="स्रोत · Source">
                <Select value={source} onChange={(e) => setSource(e.target.value as typeof source)}>
                  <option value="salesforce_import">Salesforce Hisaab-Kitab export</option>
                  <option value="excel_import">Other Excel sheet</option>
                </Select>
              </Field>
              <Field label="तारीख का क्रम · Date order" hint="Detected from the data; change if wrong">
                <Select value={order} onChange={(e) => setOrder(e.target.value as DateOrder)}>
                  <option value="dmy">Day / Month / Year (24/02/2026)</option>
                  <option value="mdy">Month / Day / Year (02/24/2026)</option>
                </Select>
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {IMPORT_FIELDS.map((fd) => (
                <Field key={fd.key} label={fd.label} required={fd.required}>
                  <Select value={map[fd.key] ?? ""} onChange={(e) => setMap({ ...map, [fd.key]: e.target.value })}>
                    <option value="">— not in file —</option>
                    {sheet.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </Select>
                </Field>
              ))}
            </div>
            <p className="text-xs text-muted">Map either “Amount” (+ “Type”, or negative numbers for debits) or separate “Credit amount” / “Debit amount” columns.</p>
            <Toggle checked={unmatchedAsIncome} onChange={setUnmatchedAsIncome} label="Record credits from unknown names as “Other income”"
              hint="Otherwise credits whose name is not in the member directory are flagged as errors so you can add the member first." />
          </Card>

          <Card className="p-4 sm:p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="font-hindi font-semibold text-forest">3. पूर्वावलोकन · Preview</p>
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge>{counts.ok} valid</Badge><Badge tone="gold">{counts.dup} duplicates</Badge><Badge tone="red">{counts.err} errors</Badge>
                <Badge tone="grey">Net {money(totalValid)}</Badge>
              </div>
            </div>
            <div className="max-h-[28rem] overflow-auto rounded-xl border border-forest/10">
              <table className="w-full text-xs sm:text-sm">
                <thead className="sticky top-0 bg-cream-100 text-left text-muted">
                  <tr><th className="px-2 py-2">Row</th><th className="px-2 py-2">Status</th><th className="px-2 py-2">Date</th><th className="px-2 py-2">Type</th><th className="px-2 py-2">Party / item</th><th className="px-2 py-2 text-right">Amount</th></tr>
                </thead>
                <tbody>
                  {prepared.map((p) => (
                    <tr key={p.row} className={clsx("border-t border-forest/5 align-top", p.status === "error" && "bg-red-50", p.status === "duplicate" && "bg-gold-100/50")}>
                      <td className="px-2 py-1.5 text-muted">{p.row}</td>
                      <td className="px-2 py-1.5">
                        {p.status === "ok" ? <Badge>OK</Badge> : p.status === "duplicate" ? <Badge tone="gold">Duplicate</Badge> : <Badge tone="red">Error</Badge>}
                        {p.errors.length > 0 && <p className="mt-1 max-w-[16rem] text-[11px] text-red-700">{p.errors.join("; ")}</p>}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5">{p.rec?.txn_date ?? String(map.date ? p.raw[map.date] ?? "" : "")}</td>
                      <td className="px-2 py-1.5">{p.rec ? KIND_LABELS[p.rec.kind].en : ""}</td>
                      <td className="px-2 py-1.5">{p.rec?.title ?? p.memberName ?? ""}</td>
                      <td className="px-2 py-1.5 text-right">{p.rec ? money(p.rec.amount) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => downloadReport(prepared.filter((p) => p.status !== "ok"))} disabled={!counts.err && !counts.dup}>
                त्रुटि रिपोर्ट · Error report
              </Button>
            </div>
          </Card>

          <Card className="space-y-3 p-4 sm:p-5">
            <p className="font-hindi font-semibold text-forest">4. पुष्टि करें · Confirm</p>
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" className="mt-1 h-5 w-5 accent-forest" checked={approved} onChange={(e) => setApproved(e.target.checked)} />
              <span>मैं पुष्टि करता/करती हूँ कि स्वामी ने इन रिकॉर्ड्स के इम्पोर्ट की स्वीकृति दी है। · I confirm the owner has approved importing these {counts.ok} records. Rows with errors or duplicates will be skipped.</span>
            </label>
            <Button size="lg" icon={<FileUp className="h-4 w-4" />} disabled={!approved || !counts.ok} loading={importing} onClick={runImport}>
              {counts.ok} प्रविष्टियाँ इम्पोर्ट करें · Import {counts.ok} entries
            </Button>
          </Card>
        </>
      )}
    </div>
  );
}

function Stat({ label, v, tone }: { label: string; v: number; tone?: string }) {
  return (
    <div className="rounded-xl bg-cream-100 p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className={clsx("text-2xl font-bold text-forest", tone)}>{v}</p>
    </div>
  );
}
