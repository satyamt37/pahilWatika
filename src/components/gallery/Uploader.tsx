"use client";
import { AlertCircle, CheckCircle2, Film, ImagePlus, Loader2, RotateCcw, Upload, X, Youtube } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { useToast } from "@/components/toast";
import { Button, Field, Input, Modal, Select, Tabs, Textarea } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { todayISO } from "@/lib/dates";
import { bytes, clsx } from "@/lib/format";
import { IMAGE_TYPES, processImage, sha256, VIDEO_TYPES, videoPoster, youtubeId } from "@/lib/image";
import { fileExt, randomName } from "@/lib/storage";
import { errMsg, supabase } from "@/lib/supabase";

type Stage = "queued" | "hashing" | "compressing" | "uploading" | "saving" | "done" | "error" | "duplicate" | "cancelled";

interface Item {
  key: string;
  file: File;
  preview: string | null;
  kind: "image" | "video";
  caption: string;
  stage: Stage;
  error?: string;
}

const STAGE_LABEL: Record<Stage, string> = {
  queued: "प्रतीक्षा में · Waiting",
  hashing: "जाँच · Checking",
  compressing: "छोटा कर रहे · Compressing",
  uploading: "अपलोड · Uploading",
  saving: "सहेज रहे · Saving",
  done: "पूर्ण · Done",
  error: "विफल · Failed",
  duplicate: "पहले से मौजूद · Already uploaded",
  cancelled: "रद्द · Cancelled",
};
const STAGE_PCT: Partial<Record<Stage, number>> = { queued: 0, hashing: 15, compressing: 35, uploading: 65, saving: 90, done: 100 };
const ACTIVE: Stage[] = ["hashing", "compressing", "uploading", "saving"];
const CONCURRENCY = 3;

class Cancelled extends Error {}

export interface UploaderProps {
  open: boolean;
  onClose: () => void;
  /** Called once a batch finishes with at least one new item. */
  onUploaded?: () => void;
  defaultAlbumId?: string | null;
  defaultEventId?: string | null;
}

export default function Uploader({ open, onClose, onUploaded, defaultAlbumId, defaultEventId }: UploaderProps) {
  const auth = useAuth();
  const toast = useToast();
  const [mode, setMode] = useState<"files" | "youtube">("files");
  const [items, setItems] = useState<Item[]>([]);
  const [albums, setAlbums] = useState<{ id: string; name: string }[]>([]);
  const [events, setEvents] = useState<{ id: string; title: string; event_date: string }[]>([]);
  const [albumId, setAlbumId] = useState(defaultAlbumId ?? "");
  const [eventId, setEventId] = useState(defaultEventId ?? "");
  const [takenOn, setTakenOn] = useState("");
  const [defaultCaption, setDefaultCaption] = useState("");
  const [running, setRunning] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [ytUrl, setYtUrl] = useState("");
  const [ytCaption, setYtCaption] = useState("");
  const [ytSaving, setYtSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemsRef = useRef<Item[]>([]);
  const cancelled = useRef(new Set<string>());
  const cancelAll = useRef(false);
  itemsRef.current = items;

  const { max_batch, max_image_mb, max_video_mb, keep_originals, photos_need_approval } = auth.perms;

  useEffect(() => {
    if (!open) return;
    setAlbumId(defaultAlbumId ?? "");
    setEventId(defaultEventId ?? "");
    (async () => {
      const [a, e] = await Promise.all([
        supabase.from("albums").select("id,name").order("sort_order").order("name"),
        supabase.from("events").select("id,title,event_date").order("event_date", { ascending: false }).limit(60),
      ]);
      setAlbums(a.data ?? []);
      setEvents(e.data ?? []);
    })();
  }, [open, defaultAlbumId, defaultEventId]);

  // Free object URLs when items go away.
  useEffect(() => () => itemsRef.current.forEach((i) => i.preview && URL.revokeObjectURL(i.preview)), []);

  const patch = useCallback((key: string, p: Partial<Item>) => {
    setItems((list) => list.map((i) => (i.key === key ? { ...i, ...p } : i)));
  }, []);

  const addFiles = (files: FileList | File[]) => {
    const arr = Array.from(files);
    const room = max_batch - items.filter((i) => i.stage !== "done").length;
    const accepted: Item[] = [];
    const rejected: string[] = [];
    for (const f of arr) {
      const isImg = IMAGE_TYPES.includes(f.type) || /\.(jpe?g|png|webp)$/i.test(f.name);
      const isVid = VIDEO_TYPES.includes(f.type) || /\.(mp4|webm|mov)$/i.test(f.name);
      if (!isImg && !isVid) { rejected.push(`${f.name}: केवल JPG, PNG, WEBP, MP4 · unsupported type`); continue; }
      const limit = (isImg ? max_image_mb : max_video_mb) * 1024 * 1024;
      if (f.size > limit) { rejected.push(`${f.name}: ${bytes(f.size)} > ${isImg ? max_image_mb : max_video_mb} MB`); continue; }
      if (items.some((i) => i.file.name === f.name && i.file.size === f.size) || accepted.some((i) => i.file.name === f.name && i.file.size === f.size)) continue;
      if (accepted.length >= room) { rejected.push(`${f.name}: एक बार में अधिकतम ${max_batch} · max ${max_batch} per batch`); continue; }
      accepted.push({
        key: crypto.randomUUID(),
        file: f,
        preview: isImg ? URL.createObjectURL(f) : null,
        kind: isImg ? "image" : "video",
        caption: "",
        stage: "queued",
      });
    }
    if (accepted.length) setItems((l) => [...l, ...accepted]);
    if (rejected.length) toast.error(rejected.slice(0, 3).join("\n") + (rejected.length > 3 ? `\n+${rejected.length - 3} more` : ""));
  };

  const remove = (key: string) => {
    const it = items.find((i) => i.key === key);
    if (it && ACTIVE.includes(it.stage)) {
      cancelled.current.add(key);
      patch(key, { stage: "cancelled" });
      return;
    }
    if (it?.preview) URL.revokeObjectURL(it.preview);
    setItems((l) => l.filter((i) => i.key !== key));
  };

  async function uploadOne(item: Item, uid: string, seenHashes: Set<string>): Promise<"done" | "duplicate"> {
    const check = () => {
      if (cancelAll.current || cancelled.current.has(item.key)) throw new Cancelled();
    };
    const uploaded: string[] = [];
    try {
      patch(item.key, { stage: "hashing", error: undefined });
      const hash = await sha256(item.file);
      check();
      if (seenHashes.has(hash)) return "duplicate";
      seenHashes.add(hash);
      const { data: dupe } = await supabase.from("photos").select("id").eq("file_hash", hash).is("deleted_at", null).limit(1);
      if (dupe && dupe.length) return "duplicate";

      patch(item.key, { stage: "compressing" });
      const base = randomName("x").replace(/\.x$/, "");
      const dir = `u/${uid}`;
      let display: Blob, thumb: Blob | null, width: number | null = null, height: number | null = null;
      let displayPath: string, mime: string;
      if (item.kind === "image") {
        const p = await processImage(item.file);
        display = p.display;
        thumb = p.thumb;
        width = p.width;
        height = p.height;
        mime = display.type || "image/jpeg";
        displayPath = `${dir}/${base}.${mime === "image/jpeg" ? "jpg" : fileExt(item.file.name, "jpg")}`;
      } else {
        display = item.file;
        const poster = await videoPoster(item.file);
        thumb = poster?.thumb ?? null;
        width = poster?.width ?? null;
        height = poster?.height ?? null;
        mime = item.file.type || "video/mp4";
        displayPath = `${dir}/${base}.${fileExt(item.file.name, "mp4")}`;
      }
      check();

      patch(item.key, { stage: "uploading" });
      const put = async (path: string, blob: Blob, type: string) => {
        const { error } = await supabase.storage.from("gallery").upload(path, blob, { contentType: type, cacheControl: "31536000", upsert: false });
        if (error) throw error;
        uploaded.push(path);
      };
      await put(displayPath, display, mime);
      check();
      const thumbPath = thumb ? `${dir}/t/${base}.jpg` : null;
      if (thumb && thumbPath) await put(thumbPath, thumb, "image/jpeg");
      check();
      let originalPath: string | null = null;
      if (keep_originals && item.kind === "image" && display !== item.file) {
        originalPath = `${dir}/orig/${base}.${fileExt(item.file.name, "jpg")}`;
        await put(originalPath, item.file, item.file.type || "image/jpeg");
        check();
      }

      patch(item.key, { stage: "saving" });
      const size = display.size + (thumb?.size ?? 0) + (originalPath ? item.file.size : 0);
      const { error } = await supabase.from("photos").insert({
        album_id: albumId || null,
        event_id: eventId || null,
        media_type: item.kind,
        storage_path: displayPath,
        thumb_path: thumbPath,
        original_path: originalPath,
        caption: (item.caption || defaultCaption).trim() || null,
        taken_on: takenOn || null,
        width,
        height,
        size_bytes: size,
        file_hash: hash,
        file_name: item.file.name.slice(0, 200),
        mime_type: mime,
      });
      if (error) {
        if (/photos_hash|duplicate key/.test(error.message)) {
          await supabase.storage.from("gallery").remove(uploaded);
          return "duplicate";
        }
        throw error;
      }
      return "done";
    } catch (e) {
      // Leave no orphaned files behind when anything after an upload fails.
      if (uploaded.length) await supabase.storage.from("gallery").remove(uploaded);
      throw e;
    }
  }

  const start = async () => {
    const uid = auth.user?.id;
    if (!uid) return;
    const queue = itemsRef.current.filter((i) => i.stage === "queued" || i.stage === "error" || i.stage === "cancelled").map((i) => i.key);
    if (!queue.length) return;
    queue.forEach((k) => { cancelled.current.delete(k); patch(k, { stage: "queued", error: undefined }); });
    cancelAll.current = false;
    setRunning(true);
    const seen = new Set<string>();
    let ok = 0, dup = 0, failed = 0;
    let cursor = 0;
    const worker = async () => {
      while (cursor < queue.length) {
        const key = queue[cursor++];
        const item = itemsRef.current.find((i) => i.key === key);
        if (!item) continue;
        if (cancelAll.current || cancelled.current.has(key)) { patch(key, { stage: "cancelled" }); continue; }
        try {
          const r = await uploadOne(item, uid, seen);
          patch(key, { stage: r });
          if (r === "done") ok++; else dup++;
        } catch (e) {
          if (e instanceof Cancelled) patch(key, { stage: "cancelled" });
          else { failed++; patch(key, { stage: "error", error: errMsg(e) }); }
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    setRunning(false);
    if (ok) {
      toast.success(
        `${ok} फ़ाइलें अपलोड हुईं · ${ok} uploaded` +
          (photos_need_approval && !auth.isAdmin ? " — स्वीकृति के बाद दिखेंगी · visible after approval" : ""),
      );
      onUploaded?.();
    }
    if (dup) toast.info(`${dup} पहले से मौजूद थीं · ${dup} already in the gallery (skipped)`);
    if (failed) toast.error(`${failed} विफल — "पुनः प्रयास" दबाएँ · ${failed} failed, tap Retry`);
  };

  const stopAll = () => {
    cancelAll.current = true;
    toast.info("रद्द किया जा रहा है · Cancelling…");
  };

  const clearDone = () => {
    items.filter((i) => i.stage === "done" || i.stage === "duplicate").forEach((i) => i.preview && URL.revokeObjectURL(i.preview));
    setItems((l) => l.filter((i) => i.stage !== "done" && i.stage !== "duplicate"));
  };

  const close = () => {
    if (running) {
      if (!window.confirm("अपलोड चल रहा है। रद्द करें? · Uploads in progress — cancel them?")) return;
      cancelAll.current = true;
    }
    items.forEach((i) => i.preview && URL.revokeObjectURL(i.preview));
    setItems([]);
    cancelled.current.clear();
    onClose();
  };

  const saveYoutube = async () => {
    const id = youtubeId(ytUrl.trim());
    if (!id) return toast.error("मान्य YouTube लिंक डालें · Enter a valid YouTube link");
    setYtSaving(true);
    const { error } = await supabase.from("photos").insert({
      album_id: albumId || null,
      event_id: eventId || null,
      media_type: "youtube",
      video_url: `https://www.youtube.com/watch?v=${id}`,
      caption: ytCaption.trim() || null,
      taken_on: takenOn || null,
    });
    setYtSaving(false);
    if (error) return toast.error(error);
    toast.success("वीडियो जोड़ा गया · Video added");
    setYtUrl("");
    setYtCaption("");
    onUploaded?.();
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (!running && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  };

  const finished = items.filter((i) => ["done", "duplicate", "error", "cancelled"].includes(i.stage)).length;
  const pending = items.filter((i) => ["queued", "error", "cancelled"].includes(i.stage)).length;
  const failedCount = items.filter((i) => i.stage === "error").length;
  const overall = items.length ? Math.round((finished / items.length) * 100) : 0;

  return (
    <Modal
      open={open}
      onClose={close}
      title="फ़ोटो / वीडियो अपलोड · Upload memories"
      wide
      footer={
        mode === "files" ? (
          <>
            {running ? (
              <Button variant="danger" onClick={stopAll} icon={<X className="h-4 w-4" />}>सब रद्द करें · Cancel all</Button>
            ) : (
              <>
                {items.some((i) => i.stage === "done" || i.stage === "duplicate") && (
                  <Button variant="ghost" onClick={clearDone}>पूर्ण हटाएँ · Clear done</Button>
                )}
                <Button variant="secondary" onClick={close}>बंद करें · Close</Button>
              </>
            )}
            <Button onClick={start} loading={running} disabled={!pending || running} icon={failedCount && !running ? <RotateCcw className="h-4 w-4" /> : <Upload className="h-4 w-4" />}>
              {failedCount && !running ? `पुनः प्रयास · Retry (${pending})` : `अपलोड करें · Upload${pending ? ` (${pending})` : ""}`}
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={close}>बंद करें · Close</Button>
            <Button onClick={saveYoutube} loading={ytSaving} icon={<Youtube className="h-4 w-4" />}>जोड़ें · Add video</Button>
          </>
        )
      }
    >
      <Tabs
        value={mode}
        onChange={(v) => !running && setMode(v)}
        className="mb-4"
        items={[
          { value: "files", label: "📷 फ़ोटो/वीडियो · Files" },
          { value: "youtube", label: "▶️ YouTube लिंक · Link" },
        ]}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Field label="एल्बम · Album">
          <Select value={albumId} onChange={(e) => setAlbumId(e.target.value)} disabled={running}>
            <option value="">— बिना एल्बम · No album —</option>
            {albums.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </Field>
        <Field label="कार्यक्रम · Event (optional)">
          <Select value={eventId} onChange={(e) => setEventId(e.target.value)} disabled={running}>
            <option value="">— कोई नहीं · None —</option>
            {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.title} ({ev.event_date})</option>)}
          </Select>
        </Field>
        <Field label="तारीख · Date taken">
          <Input type="date" value={takenOn} max={todayISO()} onChange={(e) => setTakenOn(e.target.value)} disabled={running} />
        </Field>
      </div>

      {mode === "youtube" ? (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            बड़े वीडियो YouTube पर (Unlisted) अपलोड करें और लिंक यहाँ जोड़ें — मुफ़्त और असीमित। · Upload long videos to YouTube as “Unlisted” and add the link here — free and unlimited.
          </p>
          <Field label="YouTube लिंक · Link" required>
            <Input value={ytUrl} onChange={(e) => setYtUrl(e.target.value)} placeholder="https://youtu.be/…" inputMode="url" />
          </Field>
          <Field label="विवरण · Caption">
            <Textarea value={ytCaption} onChange={(e) => setYtCaption(e.target.value)} maxLength={1000} />
          </Field>
        </div>
      ) : (
        <>
          <Field label="सभी के लिए विवरण · Caption for all (optional)" className="mb-4">
            <Input value={defaultCaption} onChange={(e) => setDefaultCaption(e.target.value)} maxLength={1000} disabled={running} placeholder="जैसे: सुबह का योग, होली मिलन…" />
          </Field>

          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={clsx(
              "flex flex-col items-center justify-center rounded-2xl border-2 border-dashed px-4 py-8 text-center transition-colors",
              dragging ? "border-leaf bg-leaf-50" : "border-forest/20 bg-white",
            )}
          >
            <ImagePlus className="mb-2 h-9 w-9 text-leaf" />
            <p className="font-hindi font-semibold text-forest">फ़ोटो चुनें या यहाँ खींचकर छोड़ें</p>
            <p className="text-sm text-muted">Choose photos or drag & drop · JPG, PNG, WEBP (≤{max_image_mb} MB), MP4 (≤{max_video_mb} MB) · max {max_batch} at once</p>
            <Button className="mt-4" variant="gold" onClick={() => inputRef.current?.click()} disabled={running} icon={<ImagePlus className="h-4 w-4" />}>
              फ़ाइलें चुनें · Choose files
            </Button>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime"
              className="hidden"
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>

          {items.length > 0 && (
            <>
              <div className="mt-4 flex items-center gap-3">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-cream-200">
                  <div className="h-full rounded-full bg-leaf transition-[width] duration-300" style={{ width: `${overall}%` }} />
                </div>
                <span className="shrink-0 text-sm text-muted">{finished}/{items.length}</span>
              </div>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {items.map((it) => {
                  const pct = STAGE_PCT[it.stage] ?? 100;
                  return (
                    <li key={it.key} className="flex gap-3 rounded-xl bg-white p-2 shadow-sm">
                      <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-cream-200">
                        {it.preview ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={it.preview} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <span className="flex h-full w-full items-center justify-center text-forest"><Film className="h-6 w-6" /></span>
                        )}
                        {ACTIVE.includes(it.stage) && (
                          <span className="absolute inset-0 flex items-center justify-center bg-black/35"><Loader2 className="h-5 w-5 animate-spin text-white" /></span>
                        )}
                        {it.stage === "done" && <span className="absolute inset-0 flex items-center justify-center bg-forest/45"><CheckCircle2 className="h-6 w-6 text-gold" /></span>}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start gap-1">
                          <p className="min-w-0 flex-1 truncate text-sm font-medium text-forest">{it.file.name}</p>
                          {it.stage !== "done" && (
                            <button onClick={() => remove(it.key)} className="-mr-1 -mt-1 rounded-full p-1.5 text-muted hover:bg-cream-200" aria-label={ACTIVE.includes(it.stage) ? "Cancel" : "Remove"}>
                              <X className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                        <p className={clsx("flex items-center gap-1 text-xs", it.stage === "error" ? "text-red-600" : it.stage === "duplicate" ? "text-gold-700" : "text-muted")}>
                          {it.stage === "error" && <AlertCircle className="h-3 w-3" />}
                          {STAGE_LABEL[it.stage]} · {bytes(it.file.size)}
                        </p>
                        {it.error && <p className="truncate text-xs text-red-600" title={it.error}>{it.error}</p>}
                        {it.stage === "queued" || it.stage === "error" || it.stage === "cancelled" ? (
                          <input
                            value={it.caption}
                            onChange={(e) => patch(it.key, { caption: e.target.value })}
                            placeholder="विवरण · Caption"
                            maxLength={1000}
                            className="mt-1 h-8 w-full rounded-lg border border-forest/10 px-2 text-sm focus:border-leaf focus:outline-none"
                          />
                        ) : (
                          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-cream-200">
                            <div className="h-full rounded-full bg-leaf transition-[width] duration-500" style={{ width: `${pct}%` }} />
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {(photos_need_approval && !auth.isAdmin) && (
            <p className="mt-3 text-xs text-muted">नई फ़ोटो एडमिन की स्वीकृति के बाद सबको दिखेंगी · New photos appear for everyone after admin approval.</p>
          )}
        </>
      )}
    </Modal>
  );
}
