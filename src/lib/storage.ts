import { supabase } from "./supabase";

export type PrivateBucket = "gallery" | "receipts";

/** Public URL for files in the public `site` bucket. */
export function publicUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  return supabase.storage.from("site").getPublicUrl(path).data.publicUrl;
}

// Signed URLs for private buckets, cached in memory until shortly before expiry.
const TTL = 60 * 60 * 6; // 6 hours
const cache = new Map<string, { url: string; exp: number }>();

export async function signedUrls(bucket: PrivateBucket, paths: (string | null | undefined)[]): Promise<Record<string, string>> {
  const now = Date.now();
  const out: Record<string, string> = {};
  const missing: string[] = [];
  for (const p of paths) {
    if (!p) continue;
    const hit = cache.get(`${bucket}/${p}`);
    if (hit && hit.exp > now) out[p] = hit.url;
    else if (!missing.includes(p)) missing.push(p);
  }
  for (let i = 0; i < missing.length; i += 100) {
    const chunk = missing.slice(i, i + 100);
    const { data } = await supabase.storage.from(bucket).createSignedUrls(chunk, TTL);
    for (const r of data ?? []) {
      if (r.signedUrl && r.path) {
        out[r.path] = r.signedUrl;
        cache.set(`${bucket}/${r.path}`, { url: r.signedUrl, exp: now + (TTL - 600) * 1000 });
      }
    }
  }
  return out;
}

export async function signedUrl(bucket: PrivateBucket, path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  return (await signedUrls(bucket, [path]))[path] ?? null;
}

/** Short-lived signed URL that makes the browser download the file with `filename`. */
export async function downloadUrl(bucket: PrivateBucket, path: string, filename: string): Promise<string | null> {
  const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 300, { download: filename });
  return data?.signedUrl ?? null;
}

export function fileExt(name: string, fallback = "bin"): string {
  const m = /\.([a-z0-9]{1,5})$/i.exec(name);
  return (m?.[1] ?? fallback).toLowerCase();
}

/** Random, unguessable object name. */
export function randomName(ext: string): string {
  const id = crypto.randomUUID().replace(/-/g, "");
  return `${Date.now().toString(36)}-${id}.${ext}`;
}

/** Upload one file to the public `site` bucket (admins only, enforced by storage policy). */
export async function uploadSiteFile(folder: string, file: Blob, ext: string): Promise<string> {
  const path = `${folder}/${randomName(ext)}`;
  const { error } = await supabase.storage.from("site").upload(path, file, {
    contentType: file.type || undefined,
    cacheControl: "31536000",
  });
  if (error) throw error;
  return path;
}
