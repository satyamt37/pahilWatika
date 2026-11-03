"use client";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/components/toast";
import {
  Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, Input, Loading, Modal, Select, Tabs, Textarea, Toggle,
} from "@/components/ui";
import { must, useLoad } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";

type Section = "templates" | "thoughts" | "missing";

export default function CelebrationsAdmin() {
  const [sec, setSec] = useState<Section>("templates");
  return (
    <div className="space-y-4">
      <Tabs<Section>
        value={sec}
        onChange={setSec}
        className="mx-0 px-0"
        items={[
          { value: "templates", label: "शुभकामना संदेश · Greetings" },
          { value: "thoughts", label: "सुविचार · Thoughts" },
          { value: "missing", label: "अधूरी जानकारी · Missing dates" },
        ]}
      />
      {sec === "templates" && <Templates />}
      {sec === "thoughts" && <Thoughts />}
      {sec === "missing" && <MissingDates />}
    </div>
  );
}

// ------------------------------------------------------------------ greeting templates
interface Template {
  id: string;
  kind: "birthday" | "anniversary";
  lang: "hi" | "en";
  title: string;
  body: string;
  is_default: boolean;
}

function Templates() {
  const toast = useToast();
  const { data, error, loading, reload } = useLoad(async () => must(await supabase.from("greeting_templates").select("*").order("kind").order("lang")) as Template[], []);
  const [edit, setEdit] = useState<Partial<Template> | null>(null);
  const [del, setDel] = useState<Template | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!edit) return;
    if (!edit.title?.trim() || !edit.body?.trim()) return toast.error("Heading and message are required");
    setBusy(true);
    const row = { kind: edit.kind ?? "birthday", lang: edit.lang ?? "hi", title: edit.title.trim(), body: edit.body.trim(), is_default: !!edit.is_default };
    // Only one default per kind.
    if (row.is_default) {
      const q = supabase.from("greeting_templates").update({ is_default: false }).eq("kind", row.kind);
      const { error: e0 } = edit.id ? await q.neq("id", edit.id) : await q;
      if (e0) {
        setBusy(false);
        return toast.error(e0);
      }
    }
    const { error: e } = edit.id
      ? await supabase.from("greeting_templates").update(row).eq("id", edit.id)
      : await supabase.from("greeting_templates").insert(row);
    setBusy(false);
    if (e) return toast.error(e);
    toast.success("संदेश सहेजा गया · Template saved");
    setEdit(null);
    reload();
  };

  const remove = async () => {
    if (!del) return;
    setBusy(true);
    const { error: e } = await supabase.from("greeting_templates").delete().eq("id", del.id);
    setBusy(false);
    if (e) return toast.error(e);
    toast.success("हटाया गया · Deleted");
    setDel(null);
    reload();
  };

  if (loading && !data) return <Loading />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEdit({ kind: "birthday", lang: "hi", title: "", body: "", is_default: false })}>नया संदेश · New template</Button>
      </div>
      {!data?.length ? (
        <EmptyState title="कोई संदेश नहीं" text="Add birthday and anniversary greeting templates." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {data.map((t) => (
            <Card key={t.id} className="p-4">
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                <Badge tone="gold">{t.kind === "birthday" ? "🎂 Birthday" : "💐 Anniversary"}</Badge>
                <Badge tone="grey">{t.lang === "hi" ? "हिंदी" : "English"}</Badge>
                {t.is_default && <Badge tone="green">Default</Badge>}
              </div>
              <p className="font-hindi font-semibold text-forest">{t.title}</p>
              <p className="mt-1 line-clamp-4 whitespace-pre-line text-sm text-muted">{t.body}</p>
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => setEdit(t)}>Edit</Button>
                <Button size="sm" variant="ghost" className="text-red-700" icon={<Trash2 className="h-4 w-4" />} onClick={() => setDel(t)}>Delete</Button>
              </div>
            </Card>
          ))}
        </div>
      )}
      {edit && (
        <Modal
          open
          onClose={() => setEdit(null)}
          title={edit.id ? "संदेश संपादित करें · Edit template" : "नया संदेश · New template"}
          footer={<><Button variant="secondary" onClick={() => setEdit(null)}>रद्द करें</Button><Button loading={busy} onClick={save}>सहेजें · Save</Button></>}
        >
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="प्रकार · Type">
                <Select value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value as Template["kind"] })}>
                  <option value="birthday">🎂 Birthday</option>
                  <option value="anniversary">💐 Anniversary</option>
                </Select>
              </Field>
              <Field label="भाषा · Language">
                <Select value={edit.lang} onChange={(e) => setEdit({ ...edit, lang: e.target.value as Template["lang"] })}>
                  <option value="hi">हिंदी</option>
                  <option value="en">English</option>
                </Select>
              </Field>
            </div>
            <Field label="शीर्षक · Heading" required>
              <Input value={edit.title ?? ""} onChange={(e) => setEdit({ ...edit, title: e.target.value })} maxLength={80} />
            </Field>
            <Field label="संदेश · Message" required>
              <Textarea value={edit.body ?? ""} onChange={(e) => setEdit({ ...edit, body: e.target.value })} rows={6} maxLength={500} />
            </Field>
            <Toggle checked={!!edit.is_default} onChange={(v) => setEdit({ ...edit, is_default: v })} label="डिफ़ॉल्ट संदेश · Use by default" />
          </div>
        </Modal>
      )}
      <ConfirmDialog open={!!del} title="संदेश हटाएँ? · Delete template?" message={<>“{del?.title}” will be deleted.</>} loading={busy} onConfirm={remove} onCancel={() => setDel(null)} />
    </div>
  );
}

// ------------------------------------------------------------------ thoughts
interface Thought {
  id: string;
  text: string;
  author: string | null;
  active: boolean;
  created_at: string;
}

function Thoughts() {
  const toast = useToast();
  const { data, error, loading, reload, setData } = useLoad(async () => must(await supabase.from("thoughts").select("*").order("created_at")) as Thought[], []);
  const [edit, setEdit] = useState<Partial<Thought> | null>(null);
  const [del, setDel] = useState<Thought | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!edit?.text?.trim()) return toast.error("Please write the thought");
    setBusy(true);
    const row = { text: edit.text.trim(), author: edit.author?.trim() || null, active: edit.active ?? true };
    const { error: e } = edit.id ? await supabase.from("thoughts").update(row).eq("id", edit.id) : await supabase.from("thoughts").insert(row);
    setBusy(false);
    if (e) return toast.error(e);
    toast.success("सुविचार सहेजा गया · Saved");
    setEdit(null);
    reload();
  };

  const toggle = async (t: Thought, active: boolean) => {
    setData((d) => d?.map((x) => (x.id === t.id ? { ...x, active } : x)) ?? null);
    const { error: e } = await supabase.from("thoughts").update({ active }).eq("id", t.id);
    if (e) {
      toast.error(e);
      reload();
    }
  };

  const remove = async () => {
    if (!del) return;
    setBusy(true);
    const { error: e } = await supabase.from("thoughts").delete().eq("id", del.id);
    setBusy(false);
    if (e) return toast.error(e);
    toast.success("हटाया गया · Deleted");
    setDel(null);
    reload();
  };

  if (loading && !data) return <Loading />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">The homepage shows one active thought per day, in rotation.</p>
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEdit({ text: "", author: "", active: true })}>नया सुविचार · New thought</Button>
      </div>
      {!data?.length ? (
        <EmptyState title="कोई सुविचार नहीं" text="Add thoughts for the homepage." />
      ) : (
        <Card className="divide-y divide-forest/5">
          {data.map((t) => (
            <div key={t.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="font-hindi text-forest">“{t.text}”</p>
                {t.author && <p className="text-sm text-muted">— {t.author}</p>}
              </div>
              <div className="flex items-center gap-2">
                <Toggle checked={t.active} onChange={(v) => toggle(t, v)} label={t.active ? "Active" : "Hidden"} />
                <Button size="sm" variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => setEdit(t)} aria-label="Edit" />
                <Button size="sm" variant="ghost" className="text-red-700" icon={<Trash2 className="h-4 w-4" />} onClick={() => setDel(t)} aria-label="Delete" />
              </div>
            </div>
          ))}
        </Card>
      )}
      {edit && (
        <Modal
          open
          onClose={() => setEdit(null)}
          title={edit.id ? "सुविचार संपादित करें · Edit thought" : "नया सुविचार · New thought"}
          footer={<><Button variant="secondary" onClick={() => setEdit(null)}>रद्द करें</Button><Button loading={busy} onClick={save}>सहेजें · Save</Button></>}
        >
          <div className="space-y-3">
            <Field label="सुविचार · Thought" required>
              <Textarea value={edit.text ?? ""} onChange={(e) => setEdit({ ...edit, text: e.target.value })} rows={3} maxLength={400} />
            </Field>
            <Field label="स्रोत / लेखक · Source or author">
              <Input value={edit.author ?? ""} onChange={(e) => setEdit({ ...edit, author: e.target.value })} />
            </Field>
            <Toggle checked={edit.active ?? true} onChange={(v) => setEdit({ ...edit, active: v })} label="होमपेज पर दिखाएँ · Show on homepage" />
          </div>
        </Modal>
      )}
      <ConfirmDialog open={!!del} title="सुविचार हटाएँ? · Delete thought?" message={<>“{del?.text}” will be deleted.</>} loading={busy} onConfirm={remove} onCancel={() => setDel(null)} />
    </div>
  );
}

// ------------------------------------------------------------------ members missing dates
interface MemberDates {
  id: string;
  full_name: string;
  birth_day: number | null;
  birth_year: number | null;
  married: boolean | null;
  anniv_day: number | null;
  anniv_year: number | null;
  phone: string | null;
  status: string;
  notes: string | null;
}

function MissingDates() {
  const { data, error, loading, reload } = useLoad(
    async () => must(await supabase.from("members").select("id,full_name,birth_day,birth_year,married,anniv_day,anniv_year,phone,status,notes").eq("status", "active").order("full_name")) as MemberDates[],
    [],
  );
  if (loading && !data) return <Loading />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  const rows = (data ?? [])
    .map((m) => {
      const gaps: string[] = [];
      if (!m.birth_day) gaps.push("Birthday");
      else if (!m.birth_year) gaps.push("Birth year");
      if (m.married === null) gaps.push("Marital status");
      if (m.married && !m.anniv_day) gaps.push("Anniversary");
      else if (m.married && m.anniv_day && !m.anniv_year) gaps.push("Anniversary year");
      if (!m.phone) gaps.push("Mobile");
      return { m, gaps };
    })
    .filter((r) => r.gaps.length || r.m.notes);
  if (!rows.length) return <EmptyState title="सारी जानकारी पूरी है" text="All active members have complete celebration details." />;
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted">{rows.length} members need attention. Edit them in the <b>Members</b> tab.</p>
      <Card className="divide-y divide-forest/5">
        {rows.map(({ m, gaps }) => (
          <div key={m.id} className="p-3">
            <p className="font-medium text-forest">{m.full_name}</p>
            <div className="mt-1 flex flex-wrap gap-1">{gaps.map((g) => <Badge key={g} tone="gold">Missing: {g}</Badge>)}</div>
            {m.notes && <p className="mt-1 text-xs text-muted">📝 {m.notes}</p>}
          </div>
        ))}
      </Card>
    </div>
  );
}
