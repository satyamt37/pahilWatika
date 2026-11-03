"use client";
import { Images, PlayCircle } from "lucide-react";
import Link from "next/link";
import { EmptyState, ErrorState, LinkButton, Skeleton } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { must, useLoad } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import type { Photo } from "@/lib/types";
import { thumbUrls } from "./Lightbox";

/** Homepage strip of the most recent approved photos. */
export default function LatestPhotos({ limit = 8 }: { limit?: number }) {
  const auth = useAuth();
  const { data, loading, error, reload } = useLoad(async () => {
    if (auth.loading) return null;
    const photos = must(
      await supabase.from("photos").select("*").is("deleted_at", null).eq("status", "approved")
        .order("created_at", { ascending: false }).limit(limit),
    ) as Photo[];
    return { photos, thumbs: await thumbUrls(photos) };
  }, [limit, auth.loading, auth.isMember]);

  if (loading || !data) {
    return (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {Array.from({ length: Math.min(limit, 8) }, (_, i) => <Skeleton key={i} className="aspect-square" />)}
      </div>
    );
  }
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data.photos.length) {
    return (
      <EmptyState
        icon={<Images className="h-7 w-7" />}
        title="यादें जल्द आ रही हैं"
        text="No photos yet. Memories shared by the parivaar will appear here."
        action={<LinkButton href="/gallery/" variant="secondary">गैलरी देखें · Open gallery</LinkButton>}
      />
    );
  }
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
      {data.photos.map((p) => (
        <Link
          key={p.id}
          href={`/gallery/?photo=${p.id}`}
          className="group relative block aspect-square overflow-hidden rounded-xl bg-cream-200 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
          aria-label={p.caption ?? "Photo"}
        >
          {data.thumbs[p.id] && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.thumbs[p.id]} alt={p.caption ?? ""} loading="lazy" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
          )}
          {p.media_type !== "image" && (
            <span className="absolute inset-0 flex items-center justify-center"><PlayCircle className="h-10 w-10 text-white drop-shadow-lg" /></span>
          )}
        </Link>
      ))}
    </div>
  );
}
