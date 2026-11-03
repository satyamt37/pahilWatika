"use client";
import { useEffect, useState } from "react";
import { signedUrls, type PrivateBucket } from "./storage";

/** Resolve signed URLs for a list of private storage paths (e.g. member photos). */
export function useSignedUrls(bucket: PrivateBucket, paths: (string | null | undefined)[]): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const key = paths.filter(Boolean).join("|");
  useEffect(() => {
    if (!key) return;
    let alive = true;
    signedUrls(bucket, key.split("|")).then((u) => alive && setUrls((prev) => ({ ...prev, ...u })));
    return () => {
      alive = false;
    };
  }, [bucket, key]);
  return urls;
}
