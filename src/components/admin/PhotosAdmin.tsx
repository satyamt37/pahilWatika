"use client";
import { CheckSquare, Eye, EyeOff, FolderInput, Globe, HardDrive, Lock, PlayCircle, RotateCcw, ShieldCheck, Square, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { thumbUrls } from "@/components/gallery/Lightbox";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Loading, Select, Tabs } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { formatDateTime } from "@/lib/dates";
import { bytes, clsx } from "@/lib/format";
import { must, useLoad } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import type { Photo } from "@/lib/types";

type Tab = "pending" | "all" | "hidden" | "trash";
const FREE_TIER = 1024 ** 3; // Supabase free plan: 1 GB file storage
const LIMIT = 120;

export default function PhotosAdmin() {
  const auth = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("pending");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<null | "delete" | "empty">(null);
  const [moveTo, setMoveTo] = useState("");

  const usage = useLoad(async () => {
    const { data } = await supabase.rpc("storage_usage");
    return (data as { bytes: number; objects: number } | null) ?? null;
  }, []);

  const albums = useLoad(async () => must(await supabase.from("albums").select("id,name").order("sort_order")) as { id: string; name: string }[], []);

  const list = useLoad(async () => {
    let q = supabase.from("photos").select("*").order("created_at", { ascending: false }).limit(LIMIT);
    if (tab === "trash") q = q.not("deleted_at", "is", null);
    else {
      q = q.is("deleted_at", null);
      if (tab === "pending") q = q.eq("status", "pending");
      if (tab === "hidden") q = q.eq("status", "hidden");
    }
    const photos = must(await q) as Photo[];
    return { photos, thumbs: await thumbUrls(photos) };
  }, [tab]);

  useEffect(() => setSelected(new Set()), [tab]);

  const photos = list.data?.photos ?? [];
  const ids = Array.from(selected);
  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const allSelected = photos.length > 0 && photos.every((p) => selected.has(p.id));

  const run = async (label: string, fn: () => PromiseLike<{ error: unknown }>) => {
    if (!ids.length) return;
    setBusy(true);
    const { error } = await fn();
    setBusy(false);
    if (error) return toast.error(error);
    toast.success(`${label} (${ids.length})`);
    setSelected(new Set());
    list.reload();
    usage.reload();
  };

  const update = (label: string, patch: Partial<Photo>) => run(label, () => supabase.from("photos").update(patch).in("id", ids));

  const softDelete = async () => {
    await update("ट्रैश में भेजा · Moved to trash", { deleted_at: new Date().toISOString(), deleted_by: auth.user?.id ?? null } as Partial<Photo>);
    setConfirm(null);
  };

  const removeFiles = async (rows: Photo[]) => {
    const paths = rows.flatMap((p) => [p.storage_path, p.thumb_path, p.original_path]).filter(Boolean) as string[];
    for (let i = 0; i < paths.length; i += 100) {
      const { error } = await supabase.storage.from("gallery").remove(paths.slice(i, i + 100));
      if (error) throw error;
    }
  };

  const emptyTrash = async () => {
    setBusy(true);
    try {
      // Only the selected items, or everything in trash when nothing is selected.
      let q = supabase.from("photos").select("*").not("deleted_at", "is", null);
      if (ids.length) q = q.in("id", ids);
      const rows = must(await q) as Photo[];
      // Albums pointing at these as covers are cleared by the FK (on delete set null).
      await removeFiles(rows);
      for (let i = 0; i < rows.length; i += 100) {
        must(await supabase.from("photos").delete().in("id", rows.slice(i, i + 100).map((r) => r.id)));
      }
      toast.success(`${rows.length} स्थायी रूप से हटाई गईं · permanently deleted`);
      setSelected(new Set());
      list.reload();
      usage.reload();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const used = usage.data?.bytes ?? 0;
  const pct = Math.min(100, (used / FREE_TIER) * 100);

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-leaf-50 text-leaf-700"><HardDrive className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-forest">भंडारण · Storage used (all buckets)</p>
            <p className="text-xs text-muted">
              {usage.loading ? "…" : `${bytes(used)} of 1 GB free tier · ${usage.data?.objects ?? 0} files`}
            </p>
          </div>
          <span className="text-sm font-semibold text-forest">{pct.toFixed(0)}%</span>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-cream-200">
          <div className={clsx("h-full rounded-full", pct > 85 ? "bg-red-500" : pct > 65 ? "bg-gold" : "bg-leaf")} style={{ width: `${pct}%` }} />
        </div>
        {pct > 80 && (
          <p className="mt-2 text-xs text-red-700">
            Storage is nearly full. Empty the trash, turn off “keep originals” in Settings, or add long videos as YouTube links.
          </p>
        )}
      </Card>

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: "pending", label: "लंबित · Pending" },
          { value: "all", label: "सभी · All" },
          { value: "hidden", label: "छिपी · Hidden" },
          { value: "trash", label: "ट्रैश · Trash" },
        ]}
      />

      {/* bulk action bar */}
      <div className="sticky top-16 z-10 flex flex-wrap items-center gap-2 rounded-2xl bg-white/95 p-2 shadow-sm backdrop-blur">
        <Button size="sm" variant="ghost" onClick={() => setSelected(allSelected ? new Set() : new Set(photos.map((p) => p.id)))}
          icon={allSelected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}>
          {selected.size ? `${selected.size} चुनी · selected` : "सभी चुनें · Select all"}
        </Button>
        {tab !== "trash" ? (
          <>
            <Button size="sm" variant="secondary" disabled={!ids.length || busy} onClick={() => update("स्वीकृत · Approved", { status: "approved" })} icon={<ShieldCheck className="h-4 w-4" />}>Approve</Button>
            <Button size="sm" variant="secondary" disabled={!ids.length || busy} onClick={() => update("छिपाई · Hidden", { status: "hidden" })} icon={<EyeOff className="h-4 w-4" />}>Hide</Button>
            <Button size="sm" variant="secondary" disabled={!ids.length || busy} onClick={() => update("सार्वजनिक · Public", { is_public: true })} icon={<Globe className="h-4 w-4" />}>Public</Button>
            <Button size="sm" variant="secondary" disabled={!ids.length || busy} onClick={() => update("निजी · Members only", { is_public: false })} icon={<Lock className="h-4 w-4" />}>Members only</Button>
            <div className="flex items-center gap-1">
              <Select value={moveTo} onChange={(e) => setMoveTo(e.target.value)} className="h-9 w-40 text-sm" aria-label="Move to album">
                <option value="">एल्बम चुनें · Album…</option>
                <option value="__none">— बिना एल्बम · None —</option>
                {(albums.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>
              <Button size="sm" variant="secondary" disabled={!ids.length || !moveTo || busy}
                onClick={() => update("एल्बम बदला · Moved", { album_id: moveTo === "__none" ? null : moveTo })} icon={<FolderInput className="h-4 w-4" />}>Move</Button>
            </div>
            <Button size="sm" variant="danger" disabled={!ids.length || busy} onClick={() => setConfirm("delete")} icon={<Trash2 className="h-4 w-4" />}>Delete</Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="secondary" disabled={!ids.length || busy}
              onClick={() => update("पुनः स्थापित · Restored", { deleted_at: null, deleted_by: null } as Partial<Photo>)} icon={<RotateCcw className="h-4 w-4" />}>Restore</Button>
            <Button size="sm" variant="danger" disabled={busy || !photos.length} onClick={() => setConfirm("empty")} icon={<Trash2 className="h-4 w-4" />}>
              {ids.length ? `स्थायी रूप से हटाएँ · Delete forever (${ids.length})` : "ट्रैश खाली करें · Empty trash"}
            </Button>
          </>
        )}
      </div>

      {list.loading ? (
        <Loading />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : !photos.length ? (
        <EmptyState title={tab === "pending" ? "कोई लंबित फ़ोटो नहीं" : tab === "trash" ? "ट्रैश खाली है" : "कोई फ़ोटो नहीं"} text={tab === "pending" ? "Nothing waiting for approval." : "No photos here."} />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
            {photos.map((p) => {
              const sel = selected.has(p.id);
              const t = list.data?.thumbs[p.id];
              return (
                <button
                  key={p.id}
                  onClick={() => toggle(p.id)}
                  className={clsx("group relative aspect-square overflow-hidden rounded-xl bg-cream-200 text-left", sel && "ring-4 ring-gold")}
                  aria-pressed={sel}
                  title={`${p.caption ?? p.file_name ?? ""}\n${formatDateTime(p.created_at)} · ${bytes(p.size_bytes)}`}
                >
                  {t && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={t} alt={p.caption ?? ""} loading="lazy" className={clsx("h-full w-full object-cover", sel && "opacity-80")} />
                  )}
                  {p.media_type !== "image" && <PlayCircle className="absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 text-white drop-shadow" />}
                  <span className="absolute left-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-md bg-white/90 text-forest shadow">
                    {sel ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                  </span>
                  <span className="absolute bottom-1 left-1 right-1 flex flex-wrap gap-1">
                    {p.status !== "approved" && <Badge tone={p.status === "pending" ? "gold" : "grey"}>{p.status}</Badge>}
                    {p.is_public ? <Badge tone="green"><Eye className="h-3 w-3" />public</Badge> : null}
                  </span>
                </button>
              );
            })}
          </div>
          {photos.length >= LIMIT && <p className="text-center text-xs text-muted">Showing the latest {LIMIT}. Act on these to see more.</p>}
        </>
      )}

      <ConfirmDialog
        open={confirm === "delete"}
        title="ट्रैश में भेजें? · Move to trash?"
        message={`${ids.length} फ़ोटो गैलरी से हट जाएँगी। ट्रैश से पुनः स्थापित की जा सकती हैं। · ${ids.length} item(s) will be removed from the gallery; they can be restored from Trash.`}
        confirmLabel="ट्रैश में भेजें · Move to trash"
        loading={busy}
        onConfirm={softDelete}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === "empty"}
        title="स्थायी रूप से हटाएँ? · Delete forever?"
        message={`${ids.length || "ट्रैश की सभी · All trashed"} फ़ाइलें स्टोरेज से हमेशा के लिए मिट जाएँगी। यह वापस नहीं होगा। · Files are permanently erased from storage. This cannot be undone.`}
        confirmLabel="हमेशा के लिए हटाएँ · Delete forever"
        loading={busy}
        onConfirm={emptyTrash}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
