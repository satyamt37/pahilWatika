"use client";
import {
  ChevronLeft, ChevronRight, Copy, Download, EyeOff, Loader2, MessageCircle, Send, Share2, ShieldCheck, Trash2, X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@/components/toast";
import { Avatar, ConfirmDialog } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/dates";
import { clsx, siteUrl, whatsappUrl } from "@/lib/format";
import { youtubeId } from "@/lib/image";
import { downloadUrl, fileExt, signedUrl, signedUrls } from "@/lib/storage";
import { supabase } from "@/lib/supabase";
import type { Photo } from "@/lib/types";

export const REACTIONS = ["🙏", "❤️", "😊", "👏", "🌸"] as const;

export function youtubeThumb(url: string | null): string | null {
  const id = url ? youtubeId(url) : null;
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
}

/** Grid thumbnail URLs keyed by photo id (signed URLs for storage files, YouTube thumbnails for links). */
export async function thumbUrls(photos: Photo[]): Promise<Record<string, string>> {
  const paths = photos.filter((p) => p.media_type !== "youtube").map((p) => p.thumb_path ?? p.storage_path);
  const signed = await signedUrls("gallery", paths);
  const out: Record<string, string> = {};
  for (const p of photos) {
    if (p.media_type === "youtube") {
      const t = youtubeThumb(p.video_url);
      if (t) out[p.id] = t;
    } else {
      const key = p.thumb_path ?? p.storage_path;
      if (key && signed[key]) out[p.id] = signed[key];
    }
  }
  return out;
}

interface Comment { id: string; user_id: string; body: string; created_at: string }

export default function Lightbox({ photos, index, onIndex, onClose, onChanged }: {
  photos: Photo[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  /** Called after an admin/uploader action changes or removes the photo. */
  onChanged?: (p: Photo, removed: boolean) => void;
}) {
  const photo = photos[index];
  const auth = useAuth();
  const toast = useToast();
  const [src, setSrc] = useState<string | null>(null);
  const [loadingSrc, setLoadingSrc] = useState(true);
  const [uploader, setUploader] = useState<string | null>(null);
  const [reactions, setReactions] = useState<{ user_id: string; emoji: string }[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [commentText, setCommentText] = useState("");
  const [sending, setSending] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const touch = useRef<{ x: number; y: number } | null>(null);

  const prev = useCallback(() => index > 0 && onIndex(index - 1), [index, onIndex]);
  const next = useCallback(() => index < photos.length - 1 && onIndex(index + 1), [index, photos.length, onIndex]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose, prev, next]);

  // Load full-size media + social data for the current photo.
  useEffect(() => {
    if (!photo) return;
    let alive = true;
    setSrc(null);
    setLoadingSrc(true);
    setShareOpen(false);
    (async () => {
      if (photo.media_type !== "youtube") {
        const u = await signedUrl("gallery", photo.storage_path);
        if (alive) setSrc(u);
      }
      if (alive) setLoadingSrc(false);
    })();
    // Preload neighbours' display images.
    for (const n of [photos[index + 1], photos[index - 1]]) {
      if (n && n.media_type === "image") signedUrl("gallery", n.storage_path).then((u) => { if (u) new Image().src = u; });
    }
    setUploader(null);
    setReactions([]);
    setComments([]);
    if (auth.isMember) {
      (async () => {
        const [r, c] = await Promise.all([
          supabase.from("photo_reactions").select("user_id,emoji").eq("photo_id", photo.id),
          supabase.from("photo_comments").select("id,user_id,body,created_at").eq("photo_id", photo.id).order("created_at"),
        ]);
        if (!alive) return;
        setReactions(r.data ?? []);
        setComments((c.data as Comment[]) ?? []);
        const ids = Array.from(new Set([photo.uploaded_by, ...((c.data as Comment[]) ?? []).map((x) => x.user_id)].filter(Boolean))) as string[];
        if (ids.length) {
          const { data } = await supabase.from("user_names").select("id,name").in("id", ids);
          if (!alive) return;
          const map = Object.fromEntries((data ?? []).map((u: { id: string; name: string }) => [u.id, u.name]));
          setNames(map);
          setUploader(photo.uploaded_by ? map[photo.uploaded_by] ?? null : null);
        }
      })();
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo?.id, auth.isMember]);

  if (!photo) return null;

  const me = auth.user?.id;
  const myReaction = reactions.find((r) => r.user_id === me)?.emoji;
  const canDelete = auth.isAdmin || (!!me && photo.uploaded_by === me);
  const shareLink = siteUrl(`/gallery/?photo=${photo.id}`);
  const shareText = `${photo.caption ? photo.caption + " — " : ""}पाहिल वाटिका योग परिवार की यादें 🌿\n${shareLink}`;

  const react = async (emoji: string) => {
    if (!me) return;
    const prevState = reactions;
    if (myReaction === emoji) {
      setReactions(reactions.filter((r) => r.user_id !== me));
      const { error } = await supabase.from("photo_reactions").delete().eq("photo_id", photo.id).eq("user_id", me);
      if (error) { setReactions(prevState); toast.error(error); }
    } else {
      setReactions([...reactions.filter((r) => r.user_id !== me), { user_id: me, emoji }]);
      const { error } = await supabase.from("photo_reactions").upsert({ photo_id: photo.id, user_id: me, emoji });
      if (error) { setReactions(prevState); toast.error(error); }
    }
  };

  const sendComment = async () => {
    const body = commentText.trim();
    if (!body || !me) return;
    setSending(true);
    const { data, error } = await supabase.from("photo_comments").insert({ photo_id: photo.id, body }).select("id,user_id,body,created_at").single();
    setSending(false);
    if (error) return toast.error(error);
    setComments([...comments, data as Comment]);
    if (!names[me]) setNames({ ...names, [me]: auth.profile?.display_name ?? "You" });
    setCommentText("");
  };

  const deleteComment = async (id: string) => {
    const { error } = await supabase.from("photo_comments").delete().eq("id", id);
    if (error) return toast.error(error);
    setComments(comments.filter((c) => c.id !== id));
  };

  const download = async () => {
    const path = photo.original_path ?? photo.storage_path;
    if (!path) return;
    const name = `pahil-vatika-${photo.id.slice(0, 8)}.${fileExt(path, "jpg")}`;
    const url = await downloadUrl("gallery", path, name);
    if (!url) return toast.error("Download failed");
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: "पाहिल वाटिका योग परिवार", text: photo.caption ?? "पाहिल वाटिका की यादें", url: shareLink });
        return;
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
      }
    }
    setShareOpen((o) => !o);
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareLink);
      toast.success("लिंक कॉपी हुआ · Link copied");
    } catch {
      toast.info(shareLink);
    }
    setShareOpen(false);
  };

  const setStatus = async (status: Photo["status"]) => {
    setBusy(true);
    const { error } = await supabase.from("photos").update({ status }).eq("id", photo.id);
    setBusy(false);
    if (error) return toast.error(error);
    toast.success(status === "approved" ? "स्वीकृत · Approved" : "छिपाया गया · Hidden");
    onChanged?.({ ...photo, status }, false);
  };

  const softDelete = async () => {
    setBusy(true);
    const { error } = await supabase.from("photos").update({ deleted_at: new Date().toISOString(), deleted_by: me }).eq("id", photo.id);
    setBusy(false);
    setConfirmDelete(false);
    if (error) return toast.error(error);
    toast.success("हटाया गया · Moved to trash");
    onChanged?.(photo, true);
  };

  const ytId = photo.media_type === "youtube" && photo.video_url ? youtubeId(photo.video_url) : null;
  const counts = REACTIONS.map((e) => ({ e, n: reactions.filter((r) => r.emoji === e).length }));

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-black/95 text-white" role="dialog" aria-modal="true" aria-label="Photo viewer">
      {/* top bar */}
      <div className="flex items-center justify-between gap-2 px-2 pt-[max(0.5rem,env(safe-area-inset-top))] sm:px-4">
        <span className="px-2 text-sm text-white/70">{index + 1} / {photos.length}</span>
        <div className="flex items-center gap-1">
          {photo.media_type !== "youtube" && (
            <button onClick={download} className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10" aria-label="Download" title="डाउनलोड · Download">
              <Download className="h-5 w-5" />
            </button>
          )}
          <div className="relative">
            <button onClick={share} className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10" aria-label="Share" title="शेयर · Share">
              <Share2 className="h-5 w-5" />
            </button>
            {shareOpen && (
              <div className="absolute right-0 top-12 z-10 w-56 overflow-hidden rounded-2xl bg-white text-forest shadow-lift">
                <a href={whatsappUrl(shareText)} target="_blank" rel="noopener noreferrer" className="flex h-12 items-center gap-2 px-4 text-sm hover:bg-cream-100" onClick={() => setShareOpen(false)}>
                  <MessageCircle className="h-4 w-4 text-leaf" /> WhatsApp पर भेजें
                </a>
                <button onClick={copyLink} className="flex h-12 w-full items-center gap-2 px-4 text-sm hover:bg-cream-100">
                  <Copy className="h-4 w-4 text-leaf" /> लिंक कॉपी करें · Copy link
                </button>
              </div>
            )}
          </div>
          {auth.isAdmin && photo.status !== "approved" && (
            <button disabled={busy} onClick={() => setStatus("approved")} className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10" aria-label="Approve" title="स्वीकृत करें · Approve">
              <ShieldCheck className="h-5 w-5 text-leaf-100" />
            </button>
          )}
          {auth.isAdmin && photo.status !== "hidden" && (
            <button disabled={busy} onClick={() => setStatus("hidden")} className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10" aria-label="Hide" title="छिपाएँ · Hide">
              <EyeOff className="h-5 w-5" />
            </button>
          )}
          {canDelete && (
            <button disabled={busy} onClick={() => setConfirmDelete(true)} className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10" aria-label="Delete" title="हटाएँ · Delete">
              <Trash2 className="h-5 w-5 text-red-300" />
            </button>
          )}
          <button onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10" aria-label="Close">
            <X className="h-6 w-6" />
          </button>
        </div>
      </div>

      {/* media */}
      <div
        className="relative flex min-h-0 flex-1 items-center justify-center"
        onTouchStart={(e) => (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
        onTouchEnd={(e) => {
          if (!touch.current) return;
          const dx = e.changedTouches[0].clientX - touch.current.x;
          const dy = e.changedTouches[0].clientY - touch.current.y;
          touch.current = null;
          if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) (dx < 0 ? next : prev)();
          else if (dy > 90 && Math.abs(dy) > Math.abs(dx) * 1.5) onClose();
        }}
      >
        {loadingSrc && <Loader2 className="absolute h-8 w-8 animate-spin text-white/60" />}
        {photo.media_type === "image" && src && (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={src} src={src} alt={photo.caption ?? "Photo"} className="max-h-full max-w-full select-none object-contain" draggable={false} />
        )}
        {photo.media_type === "video" && src && (
          <video key={src} src={src} controls playsInline preload="metadata" className="max-h-full max-w-full" />
        )}
        {ytId && (
          <iframe
            key={ytId}
            src={`https://www.youtube-nocookie.com/embed/${ytId}`}
            title={photo.caption ?? "Video"}
            className="aspect-video w-full max-w-4xl"
            allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowFullScreen
          />
        )}
        {!loadingSrc && !src && !ytId && <p className="text-sm text-white/70">यह फ़ाइल उपलब्ध नहीं है · File not available</p>}

        {index > 0 && (
          <button onClick={prev} className="absolute left-2 top-1/2 hidden h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 sm:flex" aria-label="Previous">
            <ChevronLeft className="h-7 w-7" />
          </button>
        )}
        {index < photos.length - 1 && (
          <button onClick={next} className="absolute right-2 top-1/2 hidden h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 sm:flex" aria-label="Next">
            <ChevronRight className="h-7 w-7" />
          </button>
        )}
      </div>

      {/* info panel */}
      <div className="max-h-[45vh] overflow-y-auto bg-gradient-to-t from-black to-black/70 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        <div className="mx-auto max-w-3xl">
          {photo.status !== "approved" && (
            <span className="mb-2 inline-block rounded-full bg-gold px-2.5 py-0.5 text-xs font-semibold text-forest">
              {photo.status === "pending" ? "स्वीकृति लंबित · Pending approval" : "छिपा हुआ · Hidden"}
            </span>
          )}
          {photo.caption && <p className="whitespace-pre-line font-hindi text-[15px]">{photo.caption}</p>}
          <p className="mt-1 text-xs text-white/60">
            {photo.taken_on ? formatDate(photo.taken_on) : formatDateTime(photo.created_at)}
            {uploader && <> · {uploader}</>}
          </p>

          {auth.isMember && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {counts.map(({ e, n }) => (
                <button
                  key={e}
                  onClick={() => react(e)}
                  className={clsx(
                    "flex h-10 min-w-[44px] items-center justify-center gap-1 rounded-full px-3 text-lg transition-colors",
                    myReaction === e ? "bg-gold/90 text-forest" : "bg-white/10 hover:bg-white/20",
                  )}
                  aria-pressed={myReaction === e}
                  aria-label={`React ${e}`}
                >
                  {e}
                  {n > 0 && <span className="text-xs font-semibold">{n}</span>}
                </button>
              ))}
              {auth.perms.allow_comments && (
                <button onClick={() => setShowComments((s) => !s)} className="ml-auto flex h-10 items-center gap-1.5 rounded-full bg-white/10 px-3 text-sm hover:bg-white/20">
                  <MessageCircle className="h-4 w-4" /> {comments.length}
                </button>
              )}
            </div>
          )}

          {auth.isMember && auth.perms.allow_comments && showComments && (
            <div className="mt-3 space-y-2">
              {comments.map((c) => (
                <div key={c.id} className="flex items-start gap-2 rounded-xl bg-white/5 p-2.5">
                  <Avatar name={names[c.user_id] ?? "?"} size={28} className="ring-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-white/60">{names[c.user_id] ?? "सदस्य"} · {formatDateTime(c.created_at)}</p>
                    <p className="whitespace-pre-line break-words text-sm">{c.body}</p>
                  </div>
                  {(c.user_id === me || auth.isAdmin) && (
                    <button onClick={() => deleteComment(c.id)} className="rounded-full p-2 text-white/50 hover:bg-white/10" aria-label="Delete comment">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  sendComment();
                }}
              >
                <input
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  maxLength={500}
                  placeholder="टिप्पणी लिखें · Write a comment"
                  className="h-11 min-w-0 flex-1 rounded-xl bg-white/10 px-3 text-[15px] placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-gold"
                />
                <button type="submit" disabled={sending || !commentText.trim()} className="flex h-11 w-11 items-center justify-center rounded-xl bg-gold text-forest disabled:opacity-50" aria-label="Send">
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </button>
              </form>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="फ़ोटो हटाएँ? · Delete photo?"
        message="यह फ़ोटो ट्रैश में चली जाएगी। एडमिन इसे पुनः स्थापित कर सकते हैं। · The photo moves to trash; an admin can restore it."
        confirmLabel="हटाएँ · Delete"
        loading={busy}
        onConfirm={softDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
