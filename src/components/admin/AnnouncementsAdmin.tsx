"use client";
import { ImageUp, Pencil, Pin, Plus, Trash2, Users } from "lucide-react";
import { useRef, useState } from "react";
import { z } from "zod";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, Input, Loading, Modal, Select, Textarea, Toggle } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { useLoad } from "@/lib/hooks";
import { processImage } from "@/lib/image";
import { publicUrl, uploadSiteFile } from "@/lib/storage";
import { supabase } from "@/lib/supabase";
import type { Announcement } from "@/lib/types";

type Draft = Partial<Announcement> & { title: string; body: string };

const schema = z.object({
  title: z.string().trim().min(2, "Title is required").max(200),
  body: z.string().trim().min(2, "Message is required").max(5000),
});

/** datetime-local value (local time) ↔ ISO */
const toLocal = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null);

export default function AnnouncementsAdmin() {
  const toast = useToast();
  const [editing, setEditing] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState<Announcement | null>(null);
  const [readers, setReaders] = useState<{ a: Announcement; names: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const imgRef = useRef<HTMLInputElement>(null);

  const { data, error, loading, reload, setData } = useLoad(async () => {
    const { data, error } = await supabase.from("announcements").select("*").order("pinned", { ascending: false }).order("published_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as Announcement[];
  });

  async function save() {
    if (!editing) return;
    const p = schema.safeParse(editing);
    if (!p.success) {
      setErrors(Object.fromEntries(p.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    if (editing.expires_at && editing.published_at && editing.expires_at <= editing.published_at) {
      setErrors({ expires_at: "Expiry must be after the publish time" });
      return;
    }
    setErrors({});
    setBusy(true);
    const row = {
      title: editing.title.trim(),
      body: editing.body.trim(),
      image_path: editing.image_path ?? null,
      published_at: editing.published_at ?? new Date().toISOString(),
      expires_at: editing.expires_at ?? null,
      priority: editing.priority ?? "normal",
      pinned: editing.pinned ?? false,
      visibility: editing.visibility ?? "members",
      require_read: editing.require_read ?? false,
      updated_at: new Date().toISOString(),
    };
    const { data: saved, error } = editing.id
      ? await supabase.from("announcements").update(row).eq("id", editing.id).select().single()
      : await supabase.from("announcements").insert(row).select().single();
    setBusy(false);
    if (error) return toast.error(error);
    setData([saved as Announcement, ...(data ?? []).filter((a) => a.id !== (saved as Announcement).id)]);
    setEditing(null);
    toast.success("सूचना सहेजी गई · Announcement saved");
  }

  async function uploadImage(f: File | undefined) {
    if (!f || !editing) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(f.type)) return toast.error("Please choose a JPG, PNG or WEBP image");
    setBusy(true);
    try {
      const { display } = await processImage(f, { maxSide: 1600 });
      const path = await uploadSiteFile("announcements", display, "jpg");
      setEditing({ ...editing, image_path: path });
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    const { error } = await supabase.from("announcements").delete().eq("id", deleting.id);
    if (!error && deleting.image_path) await supabase.storage.from("site").remove([deleting.image_path]);
    setBusy(false);
    if (error) return toast.error(error);
    setData((data ?? []).filter((a) => a.id !== deleting.id));
    setDeleting(null);
    toast.success("Deleted");
  }

  async function showReaders(a: Announcement) {
    const { data: rows, error } = await supabase.from("announcement_reads").select("user_id, read_at").eq("announcement_id", a.id);
    if (error) return toast.error(error);
    const ids = (rows ?? []).map((r) => r.user_id as string);
    const { data: names } = ids.length ? await supabase.from("user_names").select("id,name").in("id", ids) : { data: [] };
    setReaders({ a, names: (names ?? []).map((n) => n.name as string) });
  }

  if (error) return <ErrorState message={error} onRetry={reload} />;
  const now = Date.now();

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => { setErrors({}); setEditing({ title: "", body: "", priority: "normal", visibility: "members", pinned: false, require_read: false }); }}>
          नई सूचना · New announcement
        </Button>
      </div>
      {loading ? <Loading /> : !data?.length ? <EmptyState title="कोई सूचना नहीं" text="Create the first announcement." /> : (
        <div className="space-y-2">
          {data.map((a) => {
            const expired = a.expires_at && Date.parse(a.expires_at) <= now;
            const scheduled = Date.parse(a.published_at) > now;
            return (
              <Card key={a.id} className="flex items-start gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap gap-1">
                    {a.pinned && <Badge tone="gold"><Pin className="h-3 w-3" /> Pinned</Badge>}
                    {a.priority !== "normal" && <Badge tone="red">{a.priority}</Badge>}
                    <Badge tone={a.visibility === "public" ? "grey" : "green"}>{a.visibility}</Badge>
                    {expired && <Badge tone="grey">Archived</Badge>}
                    {scheduled && <Badge tone="gold">Scheduled</Badge>}
                    {a.require_read && <Badge tone="green">Read receipt</Badge>}
                  </div>
                  <p className="font-hindi font-semibold text-forest">{a.title}</p>
                  <p className="line-clamp-2 text-sm text-muted">{a.body}</p>
                  <p className="mt-1 text-xs text-muted">{formatDateTime(a.published_at)}{a.expires_at ? ` → ${formatDateTime(a.expires_at)}` : ""}</p>
                </div>
                <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
                  {a.require_read && <Button variant="ghost" size="sm" onClick={() => showReaders(a)} aria-label="Who has read"><Users className="h-4 w-4" /></Button>}
                  <Button variant="ghost" size="sm" onClick={() => { setErrors({}); setEditing(a); }} aria-label="Edit"><Pencil className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="sm" className="text-red-600" onClick={() => setDeleting(a)} aria-label="Delete"><Trash2 className="h-4 w-4" /></Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? "सूचना संपादित करें" : "नई सूचना · New announcement"} wide
        footer={<><Button variant="secondary" onClick={() => setEditing(null)}>रद्द · Cancel</Button><Button onClick={save} loading={busy}>सहेजें · Save</Button></>}>
        {editing && (
          <div className="space-y-4">
            <Field label="शीर्षक · Title" required error={errors.title}>
              <Input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
            </Field>
            <Field label="संदेश · Message (Hindi or English)" required error={errors.body}>
              <Textarea value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} className="min-h-[160px]" />
            </Field>
            <div>
              {editing.image_path && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={publicUrl(editing.image_path)!} alt="" className="mb-2 max-h-48 rounded-xl object-cover" />
              )}
              <input ref={imgRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => uploadImage(e.target.files?.[0])} />
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" icon={<ImageUp className="h-4 w-4" />} onClick={() => imgRef.current?.click()} loading={busy}>चित्र · Image</Button>
                {editing.image_path && <Button variant="ghost" size="sm" onClick={() => setEditing({ ...editing, image_path: null })}>Remove image</Button>}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="प्रकाशन · Publish at" hint="Leave empty to publish now">
                <Input type="datetime-local" value={toLocal(editing.published_at)} onChange={(e) => setEditing({ ...editing, published_at: fromLocal(e.target.value) ?? undefined })} />
              </Field>
              <Field label="समाप्ति · Expires at (moves to archive)" error={errors.expires_at}>
                <Input type="datetime-local" value={toLocal(editing.expires_at)} onChange={(e) => setEditing({ ...editing, expires_at: fromLocal(e.target.value) })} />
              </Field>
              <Field label="प्राथमिकता · Priority">
                <Select value={editing.priority} onChange={(e) => setEditing({ ...editing, priority: e.target.value as Announcement["priority"] })}>
                  <option value="normal">सामान्य · Normal</option>
                  <option value="important">महत्वपूर्ण · Important</option>
                  <option value="urgent">अति आवश्यक · Urgent</option>
                </Select>
              </Field>
              <Field label="कौन देख सकता है · Visibility">
                <Select value={editing.visibility} onChange={(e) => setEditing({ ...editing, visibility: e.target.value as Announcement["visibility"] })}>
                  <option value="members">केवल सदस्य · Members only</option>
                  <option value="public">सभी · Public</option>
                </Select>
              </Field>
            </div>
            <Toggle checked={!!editing.pinned} onChange={(v) => setEditing({ ...editing, pinned: v })} label="📌 Pin to top" />
            <Toggle checked={!!editing.require_read} onChange={(v) => setEditing({ ...editing, require_read: v })} label="Ask members to confirm they have read it" />
          </div>
        )}
      </Modal>

      <ConfirmDialog open={!!deleting} title="सूचना हटाएँ? · Delete?" message={<>Delete “{deleting?.title}”? To keep it for history, set an expiry date instead (it moves to the archive).</>}
        confirmLabel="हटाएँ · Delete" loading={busy} onConfirm={remove} onCancel={() => setDeleting(null)} />

      <Modal open={!!readers} onClose={() => setReaders(null)} title="किसने पढ़ा · Read by">
        {readers && (readers.names.length ? (
          <ul className="list-disc space-y-1 pl-5">{readers.names.map((n, i) => <li key={i}>{n}</li>)}</ul>
        ) : <p className="text-muted">No one has confirmed yet.</p>)}
      </Modal>
    </div>
  );
}
