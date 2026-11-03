"use client";
import { Download, ExternalLink, ImagePlus, Pencil, Plus, Trash2, Users } from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { CategoryBadge, STATUS_LABEL } from "@/components/events/shared";
import { useToast } from "@/components/toast";
import {
  Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, Input, Loading, Modal, Select, Tabs, Textarea, Toggle,
} from "@/components/ui";
import { formatDate, formatTime, todayISO } from "@/lib/dates";
import { downloadXlsx } from "@/lib/excel";
import { must, useLoad } from "@/lib/hooks";
import { processImage } from "@/lib/image";
import { publicUrl, uploadSiteFile } from "@/lib/storage";
import { supabase } from "@/lib/supabase";
import { EVENT_CATEGORIES, type Album, type EventCategory, type EventRow } from "@/lib/types";

type Form = {
  title: string;
  description: string;
  category: EventCategory;
  event_date: string;
  start_time: string;
  end_time: string;
  venue: string;
  cover_path: string | null;
  organizer: string;
  registration_info: string;
  max_capacity: string;
  rsvp_enabled: boolean;
  instructions: string;
  status: EventRow["status"];
  is_public: boolean;
  album_id: string;
};

const EMPTY: Form = {
  title: "", description: "", category: "yoga", event_date: "", start_time: "", end_time: "", venue: "", cover_path: null,
  organizer: "", registration_info: "", max_capacity: "", rsvp_enabled: true, instructions: "", status: "scheduled", is_public: true, album_id: "",
};

function toForm(e: EventRow): Form {
  return {
    title: e.title, description: e.description ?? "", category: e.category, event_date: e.event_date,
    start_time: e.start_time?.slice(0, 5) ?? "", end_time: e.end_time?.slice(0, 5) ?? "", venue: e.venue ?? "", cover_path: e.cover_path,
    organizer: e.organizer ?? "", registration_info: e.registration_info ?? "", max_capacity: e.max_capacity ? String(e.max_capacity) : "",
    rsvp_enabled: e.rsvp_enabled, instructions: e.instructions ?? "", status: e.status, is_public: e.is_public, album_id: e.album_id ?? "",
  };
}

export default function EventsAdmin() {
  const toast = useToast();
  const [tab, setTab] = useState<"upcoming" | "past">("upcoming");
  const { data, error, loading, reload } = useLoad(async () => {
    const [ev, rs, al] = await Promise.all([
      supabase.from("events").select("*").order("event_date", { ascending: false }).limit(1000),
      supabase.from("event_rsvps").select("event_id,status,guests"),
      supabase.from("albums").select("id,name").order("sort_order"),
    ]);
    const counts: Record<string, { going: number; maybe: number; no: number }> = {};
    for (const r of (must(rs) ?? []) as { event_id: string; status: string; guests: number }[]) {
      const c = (counts[r.event_id] ??= { going: 0, maybe: 0, no: 0 });
      if (r.status === "going") c.going += 1 + r.guests;
      else if (r.status === "maybe") c.maybe += 1;
      else c.no += 1;
    }
    return { events: must(ev) as EventRow[], counts, albums: (must(al) ?? []) as Pick<Album, "id" | "name">[] };
  }, []);

  const [editing, setEditing] = useState<EventRow | "new" | null>(null);
  const [deleting, setDeleting] = useState<EventRow | null>(null);
  const [busy, setBusy] = useState(false);

  const today = todayISO();
  const list = useMemo(() => {
    const evs = data?.events ?? [];
    return tab === "upcoming"
      ? evs.filter((e) => e.event_date >= today).sort((a, b) => a.event_date.localeCompare(b.event_date))
      : evs.filter((e) => e.event_date < today);
  }, [data, tab, today]);

  const exportParticipants = async (e: EventRow) => {
    const { data: rows, error: err } = await supabase.from("event_participants").select("name,status,guests,note,updated_at").eq("event_id", e.id).order("name");
    if (err) return toast.error(err);
    downloadXlsx(`participants-${e.event_date}.xlsx`, [{
      name: "Participants",
      rows: (rows ?? []).map((r) => ({ Name: r.name, Status: r.status, Guests: r.guests, Note: r.note ?? "", "Updated": r.updated_at })),
    }]);
  };

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    const { error: err } = await supabase.from("events").delete().eq("id", deleting.id);
    if (!err && deleting.cover_path) await supabase.storage.from("site").remove([deleting.cover_path]);
    setBusy(false);
    if (err) return toast.error(err);
    toast.success("कार्यक्रम हटाया गया · Event deleted");
    setDeleting(null);
    reload();
  };

  if (loading && !data) return <Loading />;
  if (error) return <ErrorState message={error} onRetry={reload} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={tab} onChange={setTab} items={[{ value: "upcoming", label: "आगामी · Upcoming" }, { value: "past", label: "पिछले · Past" }]} className="mx-0 px-0" />
        <div className="flex gap-2">
          <Link href="/events/?tab=calendar" className="inline-flex h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-forest hover:bg-forest/5">
            <ExternalLink className="h-4 w-4" /> Calendar
          </Link>
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing("new")}>नया कार्यक्रम · New event</Button>
        </div>
      </div>
      <p className="text-sm text-muted">Bulk-add events from Excel in the <b>Excel import</b> tab.</p>

      {!list.length ? (
        <EmptyState title={tab === "upcoming" ? "कोई आगामी कार्यक्रम नहीं" : "कोई पिछला कार्यक्रम नहीं"} text="Create an event or import them from Excel." />
      ) : (
        <div className="space-y-2">
          {list.map((e) => {
            const c = data?.counts[e.id];
            return (
              <Card key={e.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap gap-1.5">
                    <CategoryBadge category={e.category} />
                    {e.status !== "scheduled" && <Badge tone="red">{STATUS_LABEL[e.status]}</Badge>}
                    {!e.is_public && <Badge tone="grey">Members only</Badge>}
                  </div>
                  <Link href={`/events/view/?id=${e.id}`} className="font-hindi font-semibold text-forest hover:underline">{e.title}</Link>
                  <p className="text-sm text-muted">
                    {formatDate(e.event_date)}{e.start_time ? ` · ${formatTime(e.start_time)}` : ""}{e.venue ? ` · ${e.venue}` : ""}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    <Users className="mr-1 inline h-3.5 w-3.5" />
                    {c?.going ?? 0} going{e.max_capacity ? ` / ${e.max_capacity}` : ""} · {c?.maybe ?? 0} maybe · {c?.no ?? 0} not going
                  </p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <Button size="sm" variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => exportParticipants(e)} aria-label="Export participants">RSVPs</Button>
                  <Button size="sm" variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(e)}>Edit</Button>
                  <Button size="sm" variant="ghost" className="text-red-700" icon={<Trash2 className="h-4 w-4" />} onClick={() => setDeleting(e)} aria-label="Delete" />
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {editing && (
        <EventForm
          event={editing === "new" ? null : editing}
          albums={data?.albums ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        title="कार्यक्रम हटाएँ? · Delete event?"
        message={<>“{deleting?.title}” and all its RSVPs will be permanently deleted. Photos linked to it stay in the gallery.</>}
        confirmLabel="हटाएँ · Delete"
        loading={busy}
        onConfirm={remove}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

function EventForm({ event, albums, onClose, onSaved }: {
  event: EventRow | null; albums: Pick<Album, "id" | "name">[]; onClose: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  const [f, setF] = useState<Form>(event ? toForm(event) : EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));

  const onCover = async (file: File | undefined) => {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return toast.error("Please choose a JPG, PNG or WEBP image");
    if (file.size > 25 * 1024 * 1024) return toast.error("Image is larger than 25 MB");
    setUploading(true);
    try {
      const { display } = await processImage(file, { maxSide: 1600, quality: 0.84 });
      const path = await uploadSiteFile("events", display, "jpg");
      set("cover_path", path);
    } catch (e) {
      toast.error(e);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const save = async () => {
    const errs: typeof errors = {};
    if (f.title.trim().length < 2) errs.title = "Title is required";
    if (!f.event_date) errs.event_date = "Date is required";
    if (f.start_time && f.end_time && f.end_time < f.start_time) errs.end_time = "End time must be after the start time";
    const cap = f.max_capacity ? Number(f.max_capacity) : null;
    if (cap !== null && (!Number.isInteger(cap) || cap <= 0)) errs.max_capacity = "Enter a whole number";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    const row = {
      title: f.title.trim(), description: f.description.trim() || null, category: f.category, event_date: f.event_date,
      start_time: f.start_time || null, end_time: f.end_time || null, venue: f.venue.trim() || null, cover_path: f.cover_path,
      organizer: f.organizer.trim() || null, registration_info: f.registration_info.trim() || null, max_capacity: cap,
      rsvp_enabled: f.rsvp_enabled, instructions: f.instructions.trim() || null, status: f.status, is_public: f.is_public,
      album_id: f.album_id || null,
    };
    const res = event
      ? await supabase.from("events").update({ ...row, updated_at: new Date().toISOString() }).eq("id", event.id)
      : await supabase.from("events").insert(row);
    setSaving(false);
    if (res.error) return toast.error(res.error);
    if (event?.cover_path && event.cover_path !== f.cover_path) await supabase.storage.from("site").remove([event.cover_path]);
    toast.success(event ? "कार्यक्रम अपडेट हुआ · Event updated" : "कार्यक्रम बनाया गया · Event created");
    onSaved();
  };

  const cover = publicUrl(f.cover_path);
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={event ? "कार्यक्रम संपादित करें · Edit event" : "नया कार्यक्रम · New event"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>रद्द करें · Cancel</Button>
          <Button onClick={save} loading={saving} disabled={uploading}>सहेजें · Save</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="शीर्षक · Title" required error={errors.title} className="sm:col-span-2">
          <Input value={f.title} onChange={(e) => set("title", e.target.value)} maxLength={200} />
        </Field>
        <Field label="श्रेणी · Category">
          <Select value={f.category} onChange={(e) => set("category", e.target.value as EventCategory)}>
            {Object.entries(EVENT_CATEGORIES).map(([k, c]) => <option key={k} value={k}>{c.emoji} {c.hi} · {c.en}</option>)}
          </Select>
        </Field>
        <Field label="दिनांक · Date" required error={errors.event_date}>
          <Input type="date" value={f.event_date} onChange={(e) => set("event_date", e.target.value)} />
        </Field>
        <Field label="प्रारंभ समय · Start time">
          <Input type="time" value={f.start_time} onChange={(e) => set("start_time", e.target.value)} />
        </Field>
        <Field label="समाप्ति समय · End time" error={errors.end_time}>
          <Input type="time" value={f.end_time} onChange={(e) => set("end_time", e.target.value)} />
        </Field>
        <Field label="स्थान · Venue">
          <Input value={f.venue} onChange={(e) => set("venue", e.target.value)} />
        </Field>
        <Field label="आयोजक · Organizer">
          <Input value={f.organizer} onChange={(e) => set("organizer", e.target.value)} />
        </Field>
        <Field label="विवरण · Description" className="sm:col-span-2">
          <Textarea value={f.description} onChange={(e) => set("description", e.target.value)} rows={4} />
        </Field>
        <Field label="निर्देश · Instructions" hint="What to bring, dress code, timing…" className="sm:col-span-2">
          <Textarea value={f.instructions} onChange={(e) => set("instructions", e.target.value)} rows={3} />
        </Field>
        <Field label="पंजीकरण · Registration details" hint="Contribution amount, last date, whom to contact" className="sm:col-span-2">
          <Textarea value={f.registration_info} onChange={(e) => set("registration_info", e.target.value)} rows={2} />
        </Field>
        <Field label="अधिकतम क्षमता · Max capacity" error={errors.max_capacity} hint="Leave empty for no limit">
          <Input type="number" min={1} inputMode="numeric" value={f.max_capacity} onChange={(e) => set("max_capacity", e.target.value)} />
        </Field>
        <Field label="स्थिति · Status">
          <Select value={f.status} onChange={(e) => set("status", e.target.value as Form["status"])}>
            {Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </Field>
        <Field label="एल्बम · Photo album" hint="Event photos can be grouped in this album">
          <Select value={f.album_id} onChange={(e) => set("album_id", e.target.value)}>
            <option value="">— None —</option>
            {albums.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </Field>
        <div className="space-y-1">
          <Toggle checked={f.rsvp_enabled} onChange={(v) => set("rsvp_enabled", v)} label="RSVP चालू · Enable RSVP" />
          <Toggle checked={f.is_public} onChange={(v) => set("is_public", v)} label="सार्वजनिक · Visible to visitors" hint="Off = members only" />
        </div>
        <div className="sm:col-span-2">
          <span className="mb-1.5 block text-sm font-medium text-forest">कवर फ़ोटो · Cover photo</span>
          <div className="flex flex-wrap items-center gap-3">
            {cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={cover} alt="" className="h-24 w-40 rounded-xl object-cover" />
            ) : (
              <div className="flex h-24 w-40 items-center justify-center rounded-xl bg-sunrise text-3xl">🧘</div>
            )}
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => onCover(e.target.files?.[0])} />
            <Button variant="secondary" loading={uploading} icon={<ImagePlus className="h-4 w-4" />} onClick={() => fileRef.current?.click()}>
              {cover ? "बदलें · Change" : "अपलोड · Upload"}
            </Button>
            {cover && <Button variant="ghost" onClick={() => set("cover_path", null)}>हटाएँ · Remove</Button>}
          </div>
        </div>
      </div>
    </Modal>
  );
}

