"use client";
import { must, useLoad } from "@/lib/hooks";
import { signedUrls } from "@/lib/storage";
import { supabase } from "@/lib/supabase";
import type { DirectoryMember } from "@/lib/types";

export type CelebMember = Pick<
  DirectoryMember,
  "id" | "full_name" | "photo_path" | "birth_day" | "birth_month" | "birth_year" | "anniv_day" | "anniv_month" | "anniv_year"
>;

/**
 * Members with whatever dates the viewer is allowed to see (the member_directory
 * view masks private dates), plus signed URLs for their photos.
 */
export function useCelebrationMembers(enabled: boolean) {
  return useLoad(async () => {
    if (!enabled) return { members: [] as CelebMember[], photos: {} as Record<string, string> };
    const members = must(
      await supabase
        .from("member_directory")
        .select("id,full_name,photo_path,birth_day,birth_month,birth_year,anniv_day,anniv_month,anniv_year")
        .eq("status", "active")
        .order("full_name"),
    ) as CelebMember[];
    const photos = await signedUrls("gallery", members.map((m) => m.photo_path));
    return { members, photos };
  }, [enabled]);
}
