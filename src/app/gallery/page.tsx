"use client";
import { Film, ImagePlus, Images, PlayCircle, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Lightbox, { thumbUrls } from "@/components/gallery/Lightbox";
import Uploader from "@/components/gallery/Uploader";
import { Badge, Button, EmptyState, ErrorState, Input, LinkButton, PageHeader, Select, Skeleton, Spinner } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { MONTHS_EN, todayIST } from "@/lib/dates";
import { clsx } from "@/lib/format";
import { setQueryParam, useDebounced } from "@/lib/hooks";
import { errMsg, supabase } from "@/lib/supabase";
import type { Album, Photo } from "@/lib/types";

const PAGE = 30;

function monthRange(ym: string): [string, string] {
  const [y, m] = ym.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return [`${y}-${String(m).padStart(2, "0")}-01`, next];
}

export default function GalleryPage() {
  const auth = useAuth();
  const [albums, setAlbums] = useState<Album[]>([]);
  const [album, setAlbum] = useState<string>("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim(), 350);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const reqId = useRef(0);
  const deepLinkPhoto = useRef<string | null>(null);

  const canUpload = auth.isMember && (auth.perms.members_can_upload || auth.isAdmin);

  // Read ?album= / ?photo= once.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    setAlbum(sp.get("album") ?? "");
    deepLinkPhoto.current = sp.get("photo");
    setReady(true);
  }, []);

  useEffect(() => {
    if (auth.loading) return;
    supabase.from("albums").select("*").order("sort_order").order("name").then(({ data }) => setAlbums((data as Album[]) ?? []));
  }, [auth.loading, auth.isMember]);

  const fetchPage = useCallback(
    async (offset: number) => {
      let query = supabase.from("photos").select("*").is("deleted_at", null).order("created_at", { ascending: false }).range(offset, offset + PAGE - 1);
      if (!auth.isAdmin) query = query.neq("status", "hidden");
      if (album) query = query.eq("album_id", album);
      if (q) query = query.ilike("caption", `%${q.replace(/[%_,()]/g, " ")}%`);
      let range: [string, string] | null = null;
      if (year && month) range = monthRange(`${year}-${month}`);
      else if (year) range = [`${year}-01-01`, `${+year + 1}-01-01`];
      if (range) {
        const [a, b] = range;
        query = query.or(`and(taken_on.gte.${a},taken_on.lt.${b}),and(taken_on.is.null,created_at.gte.${a},created_at.lt.${b})`);
      }
      const { data, error } = await query;
      if (error) throw error;
      return (data as Photo[]) ?? [];
    },
    [album, q, month, year, auth.isAdmin],
  );

  const addThumbs = async (list: Photo[]) => {
    const t = await thumbUrls(list);
    setThumbs((prev) => ({ ...prev, ...t }));
  };

  // First page whenever filters change.
  useEffect(() => {
    if (!ready || auth.loading) return;
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        let list = await fetchPage(0);
        // Deep link to a photo not in the first page: fetch and put it first.
        const want = deepLinkPhoto.current;
        if (want && !list.some((p) => p.id === want)) {
          const { data } = await supabase.from("photos").select("*").eq("id", want).maybeSingle();
          if (data) list = [data as Photo, ...list];
        }
        if (id !== reqId.current) return;
        await addThumbs(list);
        setPhotos(list);
        setHasMore(list.length >= PAGE);
        if (want) {
          const idx = list.findIndex((p) => p.id === want);
          if (idx >= 0) setOpen(idx);
          deepLinkPhoto.current = null;
        }
      } catch (e) {
        if (id === reqId.current) setError(errMsg(e));
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    })();
  }, [fetchPage, ready, auth.loading]);

  const loadMore = useCallback(async () => {
    if (loadingMore || loading || !hasMore) return;
    const id = reqId.current;
    setLoadingMore(true);
    try {
      const more = await fetchPage(photos.length);
      if (id !== reqId.current) return;
      await addThumbs(more);
      setPhotos((p) => {
        const ids = new Set(p.map((x) => x.id));
        return [...p, ...more.filter((x) => !ids.has(x.id))];
      });
      setHasMore(more.length >= PAGE);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoadingMore(false);
    }
  }, [fetchPage, hasMore, loading, loadingMore, photos.length]);

  // Infinite scroll.
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => entries[0].isIntersecting && loadMore(), { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore]);

  const selectAlbum = (id: string) => {
    setAlbum(id);
    setQueryParam("album", id || null);
  };

  const openAt = (i: number | null) => {
    setOpen(i);
    setQueryParam("photo", i === null ? null : photos[i]?.id ?? null);
  };

  const years = useMemo(() => {
    const y = todayIST().y;
    return Array.from({ length: 12 }, (_, i) => String(y - i));
  }, []);

  const refresh = () => {
    reqId.current++;
    setReady(false);
    setTimeout(() => setReady(true), 0);
  };

  const albumName = albums.find((a) => a.id === album)?.name;

  return (
    <div>
      <PageHeader hi="यादें" en={albumName ? `Memories · ${albumName}` : "Memories · photo & video gallery"}>
        {canUpload && (
          <Button variant="gold" onClick={() => setUploadOpen(true)} icon={<ImagePlus className="h-4 w-4" />}>
            अपलोड · Upload
          </Button>
        )}
      </PageHeader>

      {/* Album chips */}
      <div className="no-scrollbar -mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1">
        {[{ id: "", name: "सभी · All" }, ...albums].map((a) => (
          <button
            key={a.id || "all"}
            onClick={() => selectAlbum(a.id)}
            className={clsx(
              "h-10 shrink-0 rounded-full px-4 text-sm font-medium transition-colors",
              album === a.id ? "bg-forest text-white" : "bg-white text-forest shadow-sm hover:bg-cream-200",
            )}
          >
            {a.name}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-[1fr_auto_auto]">
        <div className="relative col-span-2 sm:col-span-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="विवरण खोजें · Search captions" className="pl-9" aria-label="Search captions" />
        </div>
        <Select value={year} onChange={(e) => { setYear(e.target.value); if (!e.target.value) setMonth(""); }} aria-label="Year">
          <option value="">सभी वर्ष · Any year</option>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </Select>
        <Select value={month} onChange={(e) => setMonth(e.target.value)} disabled={!year} aria-label="Month">
          <option value="">सभी महीने · Any month</option>
          {MONTHS_EN.map((m, i) => <option key={m} value={String(i + 1).padStart(2, "0")}>{m}</option>)}
        </Select>
      </div>

      {!auth.isMember && !auth.loading && (
        <p className="mb-4 rounded-xl bg-white px-4 py-3 text-sm text-muted">
          आप सार्वजनिक फ़ोटो देख रहे हैं। सभी यादें देखने के लिए लॉगिन करें। · You are seeing public photos only — sign in to see all family memories.
        </p>
      )}

      {loading ? (
        <div className="masonry">
          {Array.from({ length: 12 }, (_, i) => <Skeleton key={i} className={i % 3 === 0 ? "h-64" : i % 3 === 1 ? "h-44" : "h-56"} />)}
        </div>
      ) : error && !photos.length ? (
        <ErrorState message={error} onRetry={refresh} />
      ) : !photos.length ? (
        <EmptyState
          icon={<Images className="h-7 w-7" />}
          title="अभी कोई फ़ोटो नहीं"
          text={q || year || album ? "No photos match these filters." : "No memories here yet — be the first to share one!"}
          action={canUpload ? <Button variant="gold" onClick={() => setUploadOpen(true)} icon={<ImagePlus className="h-4 w-4" />}>फ़ोटो जोड़ें · Add photos</Button>
            : !auth.user ? <LinkButton href="/login/">लॉगिन · Sign in</LinkButton> : undefined}
        />
      ) : (
        <>
          <div className="masonry">
            {photos.map((p, i) => {
              const t = thumbs[p.id];
              const ratio = p.width && p.height ? `${p.width} / ${p.height}` : "4 / 3";
              return (
                <button
                  key={p.id}
                  onClick={() => openAt(i)}
                  className="group relative block w-full overflow-hidden rounded-xl bg-cream-200 text-left shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                  style={{ aspectRatio: p.media_type === "youtube" ? "16 / 9" : ratio }}
                  aria-label={p.caption ?? "Open photo"}
                >
                  {t ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={t} alt={p.caption ?? ""} loading="lazy" decoding="async" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-muted"><Film className="h-8 w-8" /></span>
                  )}
                  {p.media_type !== "image" && (
                    <span className="absolute inset-0 flex items-center justify-center"><PlayCircle className="h-12 w-12 text-white drop-shadow-lg" /></span>
                  )}
                  {p.status !== "approved" && (
                    <span className="absolute left-2 top-2"><Badge tone={p.status === "pending" ? "gold" : "grey"}>{p.status === "pending" ? "लंबित · Pending" : "छिपा · Hidden"}</Badge></span>
                  )}
                  {p.caption && (
                    <span className="pointer-events-none absolute inset-x-0 bottom-0 line-clamp-2 bg-gradient-to-t from-black/70 to-transparent px-2.5 pb-2 pt-6 font-hindi text-xs text-white opacity-0 transition-opacity group-hover:opacity-100 sm:text-sm">
                      {p.caption}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div ref={sentinel} className="flex h-20 items-center justify-center">
            {loadingMore && <Spinner />}
            {!hasMore && photos.length > PAGE && <span className="text-sm text-muted">सब यादें देख लीं 🌿 · You've seen everything</span>}
            {error && photos.length > 0 && <Button variant="secondary" size="sm" onClick={loadMore}>और लोड करें · Load more</Button>}
          </div>
        </>
      )}

      {open !== null && photos[open] && (
        <Lightbox
          photos={photos}
          index={open}
          onIndex={(i) => {
            openAt(i);
            if (i >= photos.length - 3) loadMore();
          }}
          onClose={() => openAt(null)}
          onChanged={(p, removed) => {
            if (removed) {
              setPhotos((list) => list.filter((x) => x.id !== p.id));
              setOpen(null);
              setQueryParam("photo", null);
            } else setPhotos((list) => list.map((x) => (x.id === p.id ? p : x)));
          }}
        />
      )}

      {canUpload && (
        <Uploader
          open={uploadOpen}
          onClose={() => setUploadOpen(false)}
          onUploaded={refresh}
          defaultAlbumId={album || null}
        />
      )}
    </div>
  );
}
