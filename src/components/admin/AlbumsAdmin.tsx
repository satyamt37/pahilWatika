"use client";
import { Check, FolderHeart, Globe, Image as ImageIcon, Lock, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { thumbUrls } from "@/components/gallery/Lightbox";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, Input, LinkButton, Loading, Modal, Spinner, Textarea, Toggle } from "@/components/ui";
import { clsx } from "@/lib/format";
import { must, useLoad } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import type { Album, Photo } from "@/lib/types";

type AlbumRow = Album & { photos: { count: number }[] };
interface Draft { id?: string; name: string; description: string; is_public: boolean; sort_order: number; cover_photo_id: string | null }

export default function AlbumsAdmin() {
  const toast = useToast();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [original, setOriginal] = useState<AlbumRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [del, setDel] = useState<AlbumRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const { data, loading, error, reload } = useLoad(async () => {
    const albums = must(
      await supabase.from("albums").select("*, photos:photos!photos_album_id_fkey(count)").order("sort_order").order("name"),
    ) as AlbumRow[];
    const coverIds = albums.map((a) => a.cover_photo_id).filter(Boolean) as string[];
    let covers: Record<string, string> = {};
    if (coverIds.length) {
      const photos = must(await supabase.from("photos").select("*").in("id", coverIds)) as Photo[];
      covers = await thumbUrls(photos);
    }
    return { albums, covers };
  }, []);

  const openNew = () => {
    setOriginal(null);
    setDraft({ name: "", description: "", is_public: false, sort_order: (data?.albums.length ?? 0) + 1, cover_photo_id: null });
  };
  const openEdit = (a: AlbumRow) => {
    setOriginal(a);
    setDraft({ id: a.id, name: a.name, description: a.description ?? "", is_public: a.is_public, sort_order: a.sort_order, cover_photo_id: a.cover_photo_id });
  };

  const save = async () => {
    if (!draft) return;
    const name = draft.name.trim();
    if (name.length < 2) return toast.error("एल्बम का नाम लिखें · Enter an album name");
    setSaving(true);
    const row = { name, description: draft.description.trim() || null, is_public: draft.is_public, sort_order: draft.sort_order, cover_photo_id: draft.cover_photo_id };
    try {
      if (draft.id) {
        must(await supabase.from("albums").update(row).eq("id", draft.id));
        // Keep photo visibility in step with the album.
        if (original && original.is_public !== draft.is_public) {
          must(await supabase.from("photos").update({ is_public: draft.is_public }).eq("album_id", draft.id));
        }
      } else {
        must(await supabase.from("albums").insert(row));
      }
      toast.success("एल्बम सहेजा गया · Album saved");
      setDraft(null);
      reload();
    } catch (e) {
      toast.error(e);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!del) return;
    setDeleting(true);
    const { error } = await supabase.from("albums").delete().eq("id", del.id);
    setDeleting(false);
    if (error) return toast.error(error);
    toast.success("एल्बम हटाया गया · Album deleted (photos kept)");
    setDel(null);
    reload();
  };

  if (loading) return <Loading />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  const albums = data?.albums ?? [];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={openNew} icon={<Plus className="h-4 w-4" />}>नया एल्बम · New album</Button>
      </div>

      {!albums.length ? (
        <EmptyState icon={<FolderHeart className="h-7 w-7" />} title="कोई एल्बम नहीं" text="Create albums like Morning Yoga, Festivals, Picnics…" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {albums.map((a) => {
            const cover = a.cover_photo_id ? data?.covers[a.cover_photo_id] : null;
            return (
              <Card key={a.id} className="overflow-hidden">
                <div className="relative aspect-[16/9] bg-gradient-to-br from-leaf-50 to-cream-200">
                  {cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={cover} alt="" loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full items-center justify-center text-leaf"><FolderHeart className="h-10 w-10" /></span>
                  )}
                  <span className="absolute right-2 top-2">
                    {a.is_public ? <Badge tone="green"><Globe className="h-3 w-3" /> Public</Badge> : <Badge tone="grey"><Lock className="h-3 w-3" /> Members</Badge>}
                  </span>
                </div>
                <div className="p-4">
                  <p className="font-semibold text-forest">{a.name}</p>
                  {a.description && <p className="font-hindi text-sm text-muted">{a.description}</p>}
                  <p className="mt-1 text-xs text-muted">{a.photos?.[0]?.count ?? 0} items · order {a.sort_order}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onClick={() => openEdit(a)} icon={<Pencil className="h-4 w-4" />}>Edit</Button>
                    <LinkButton size="sm" variant="ghost" href={`/gallery/?album=${a.id}`} icon={<ImageIcon className="h-4 w-4" />}>View</LinkButton>
                    <Button size="sm" variant="ghost" className="text-red-700" onClick={() => setDel(a)} icon={<Trash2 className="h-4 w-4" />}>Delete</Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal
        open={!!draft}
        onClose={() => setDraft(null)}
        title={draft?.id ? "एल्बम संपादित करें · Edit album" : "नया एल्बम · New album"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDraft(null)}>रद्द · Cancel</Button>
            <Button onClick={save} loading={saving}>सहेजें · Save</Button>
          </>
        }
      >
        {draft && (
          <div className="space-y-4">
            <Field label="नाम · Name" required>
              <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={80} />
            </Field>
            <Field label="विवरण · Description">
              <Textarea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} maxLength={500} />
            </Field>
            <Field label="क्रम · Display order">
              <Input type="number" min={0} value={draft.sort_order} onChange={(e) => setDraft({ ...draft, sort_order: Number(e.target.value) || 0 })} />
            </Field>
            <Toggle
              checked={draft.is_public}
              onChange={(v) => setDraft({ ...draft, is_public: v })}
              label="सार्वजनिक एल्बम · Public album"
              hint="Visitors (not signed in) can see this album's photos. Changing this updates all photos in the album."
            />
            {draft.id && (
              <CoverPicker albumId={draft.id} value={draft.cover_photo_id} onChange={(id) => setDraft({ ...draft, cover_photo_id: id })} />
            )}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!del}
        title="एल्बम हटाएँ? · Delete album?"
        message={<>“{del?.name}” हटेगा। इसकी फ़ोटो गैलरी में बनी रहेंगी (बिना एल्बम)। · The album is deleted; its photos stay in the gallery without an album.</>}
        confirmLabel="हटाएँ · Delete"
        loading={deleting}
        onConfirm={remove}
        onCancel={() => setDel(null)}
      />
    </div>
  );
}

function CoverPicker({ albumId, value, onChange }: { albumId: string; value: string | null; onChange: (id: string | null) => void }) {
  const [items, setItems] = useState<{ photos: Photo[]; thumbs: Record<string, string> } | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase.from("photos").select("*").eq("album_id", albumId).is("deleted_at", null)
        .eq("status", "approved").order("created_at", { ascending: false }).limit(40);
      const photos = (data as Photo[]) ?? [];
      const thumbs = await thumbUrls(photos);
      if (alive) setItems({ photos, thumbs });
    })();
    return () => { alive = false; };
  }, [albumId]);

  return (
    <div>
      <p className="mb-2 text-sm font-medium text-forest">कवर फ़ोटो · Cover photo</p>
      {!items ? (
        <Spinner />
      ) : !items.photos.length ? (
        <p className="text-sm text-muted">इस एल्बम में अभी फ़ोटो नहीं हैं · No photos in this album yet.</p>
      ) : (
        <div className="grid max-h-64 grid-cols-4 gap-2 overflow-y-auto">
          {items.photos.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onChange(value === p.id ? null : p.id)}
              className={clsx("relative aspect-square overflow-hidden rounded-lg bg-cream-200", value === p.id && "ring-4 ring-gold")}
              aria-pressed={value === p.id}
            >
              {items.thumbs[p.id] && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={items.thumbs[p.id]} alt="" loading="lazy" className="h-full w-full object-cover" />
              )}
              {value === p.id && <span className="absolute right-1 top-1 rounded-full bg-gold p-0.5 text-forest"><Check className="h-3 w-3" /></span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
