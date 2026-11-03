"use client";
import { ImageUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useToast } from "@/components/toast";
import { Button, Card, Field, Input, Textarea, Toggle } from "@/components/ui";
import { DEFAULT_HISAAB, DEFAULT_PERMS, DEFAULT_SITE, useAuth } from "@/lib/auth";
import { processImage } from "@/lib/image";
import { publicUrl, uploadSiteFile } from "@/lib/storage";
import { supabase } from "@/lib/supabase";
import type { HisaabSettings, Permissions, SiteSettings } from "@/lib/types";

export default function SettingsAdmin() {
  const auth = useAuth();
  const toast = useToast();
  const [site, setSite] = useState<SiteSettings>(DEFAULT_SITE);
  const [perms, setPerms] = useState<Permissions>(DEFAULT_PERMS);
  const [hisaab, setHisaab] = useState<HisaabSettings>(DEFAULT_HISAAB);
  const [busy, setBusy] = useState<string | null>(null);
  const heroRef = useRef<HTMLInputElement>(null);
  const groupRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSite(auth.site);
    setPerms(auth.perms);
    setHisaab(auth.hisaab);
  }, [auth.site, auth.perms, auth.hisaab]);

  async function save(key: "site" | "permissions" | "hisaab", value: object) {
    setBusy(key);
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("site_settings").upsert({ key, value, updated_by: u.user?.id, updated_at: new Date().toISOString() });
    setBusy(null);
    if (error) return toast.error(error);
    await auth.refreshSettings();
    toast.success("सेटिंग्स सहेजी गईं · Settings saved");
  }

  async function uploadPhoto(kind: "hero_path" | "group_photo_path", f: File | undefined) {
    if (!f) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(f.type)) return toast.error("Please choose a JPG, PNG or WEBP image");
    setBusy(kind);
    try {
      const { display } = await processImage(f, { maxSide: 2400, quality: 0.86 });
      const path = await uploadSiteFile("site", display, "jpg");
      const old = site[kind];
      const next = { ...site, [kind]: path };
      setSite(next);
      await save("site", next);
      if (old) await supabase.storage.from("site").remove([old]);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  }

  const s = (k: keyof SiteSettings) => ({
    value: (site[k] as string) ?? "",
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setSite({ ...site, [k]: e.target.value }),
  });

  return (
    <div className="space-y-5">
      <Card className="space-y-4 p-5">
        <h3 className="font-semibold text-forest">मुख्य तस्वीरें · Homepage photos</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          {([["hero_path", "Hero image (sunrise / garden)", heroRef], ["group_photo_path", "Group photograph", groupRef]] as const).map(([k, label, ref]) => (
            <div key={k}>
              <p className="mb-2 text-sm font-medium text-forest">{label}</p>
              {site[k] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={publicUrl(site[k])!} alt="" className="aspect-video w-full rounded-xl object-cover" />
              ) : <div className="flex aspect-video w-full items-center justify-center rounded-xl bg-sunrise text-sm text-cream/80">Not set</div>}
              <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => uploadPhoto(k, e.target.files?.[0])} />
              <div className="mt-2 flex gap-2">
                <Button variant="secondary" size="sm" icon={<ImageUp className="h-4 w-4" />} loading={busy === k} onClick={() => ref.current?.click()}>Upload</Button>
                {site[k] && <Button variant="ghost" size="sm" onClick={() => { const n = { ...site, [k]: null }; setSite(n); save("site", n); }}>Remove</Button>}
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted">These images are public. Use a photo everyone in it is happy to share.</p>
      </Card>

      <Card className="space-y-4 p-5">
        <h3 className="font-semibold text-forest">परिचय व संपर्क · Identity & contact</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="नाम (हिंदी)"><Input {...s("name_hi")} /></Field>
          <Field label="Name (English)"><Input {...s("name_en")} /></Field>
          <Field label="परिवार नाम"><Input {...s("family_hi")} /></Field>
          <Field label="Tagline"><Input {...s("tagline")} /></Field>
          <Field label="Supporting tagline"><Input {...s("subtagline")} /></Field>
          <Field label="Central message"><Input {...s("message")} /></Field>
          <Field label="Session time" hint="e.g. रोज़ सुबह 5:30 – 7:00 बजे"><Input {...s("session_time")} /></Field>
          <Field label="Address"><Input {...s("address")} /></Field>
          <Field label="Contact phone (public)"><Input {...s("contact_phone")} inputMode="tel" /></Field>
          <Field label="Contact email (public)"><Input {...s("contact_email")} type="email" /></Field>
        </div>
        <Field label="समुदाय परिचय · Community introduction"><Textarea {...s("intro")} className="min-h-[140px] font-hindi" /></Field>
        <div className="flex justify-end"><Button onClick={() => save("site", site)} loading={busy === "site"}>सहेजें · Save</Button></div>
      </Card>

      <Card className="space-y-3 p-5">
        <h3 className="font-semibold text-forest">अनुमतियाँ · Permissions & limits</h3>
        <Toggle checked={perms.members_can_upload} onChange={(v) => setPerms({ ...perms, members_can_upload: v })} label="Members can upload photos" />
        <Toggle checked={perms.photos_need_approval} onChange={(v) => setPerms({ ...perms, photos_need_approval: v })} label="Member uploads need admin approval" />
        <Toggle checked={perms.keep_originals} onChange={(v) => setPerms({ ...perms, keep_originals: v })} label="Keep full-size originals"
          hint="Off = photos are stored at 2048px high quality (≈0.4 MB each) to stay within free storage. On = originals are kept too (uses ~5–10× more space)." />
        <Toggle checked={perms.allow_comments} onChange={(v) => setPerms({ ...perms, allow_comments: v })} label="Allow comments on photos" />
        <Toggle checked={perms.finance_visible_to_members} onChange={(v) => setPerms({ ...perms, finance_visible_to_members: v })} label="Members can view Hisaab-Kitab (read-only)" />
        <Toggle checked={perms.members_edit_own_profile} onChange={(v) => setPerms({ ...perms, members_edit_own_profile: v })} label="Members can edit their own profile" />
        <div className="grid gap-4 pt-2 sm:grid-cols-4">
          {([["max_batch", "Files per upload"], ["max_image_mb", "Max photo MB"], ["max_video_mb", "Max video MB (≤50)"], ["uploads_per_hour", "Uploads / member / hour"]] as const).map(([k, label]) => (
            <Field key={k} label={label}>
              <Input type="number" min={1} max={k === "max_video_mb" ? 50 : 1000} value={perms[k]} onChange={(e) => setPerms({ ...perms, [k]: Math.max(1, +e.target.value || 1) })} />
            </Field>
          ))}
        </div>
        <div className="flex justify-end"><Button onClick={() => save("permissions", { ...perms, max_video_mb: Math.min(50, perms.max_video_mb) })} loading={busy === "permissions"}>सहेजें · Save</Button></div>
      </Card>

      <Card className="space-y-4 p-5">
        <h3 className="font-semibold text-forest">हिसाब-किताब · Existing Hisaab-Kitab</h3>
        <Field label="Legacy Hisaab-Kitab URL" hint="Shown on the Hisaab-Kitab page as the historical record until migration is approved">
          <Input value={hisaab.legacy_url} onChange={(e) => setHisaab({ ...hisaab, legacy_url: e.target.value })} type="url" />
        </Field>
        <Field label="Label"><Input value={hisaab.legacy_name} onChange={(e) => setHisaab({ ...hisaab, legacy_name: e.target.value })} /></Field>
        <div className="flex justify-end">
          <Button disabled={!/^https:\/\//.test(hisaab.legacy_url) && hisaab.legacy_url !== ""} onClick={() => save("hisaab", hisaab)} loading={busy === "hisaab"}>सहेजें · Save</Button>
        </div>
      </Card>
    </div>
  );
}
