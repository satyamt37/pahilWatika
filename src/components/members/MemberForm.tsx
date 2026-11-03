"use client";
import { Camera } from "lucide-react";
import { useRef, useState } from "react";
import { z } from "zod";
import { useToast } from "@/components/toast";
import { Avatar, Button, Field, Input, Select, Textarea, Toggle } from "@/components/ui";
import { MONTHS_EN } from "@/lib/dates";
import { processAvatar } from "@/lib/image";
import { randomName } from "@/lib/storage";
import { supabase } from "@/lib/supabase";
import { useSignedUrls } from "@/lib/useSigned";
import type { Member } from "@/lib/types";

export type MemberDraft = Partial<Member> & { full_name: string };

const yearNow = new Date().getFullYear();
const schema = z
  .object({
    full_name: z.string().trim().min(2, "Name is required").max(120),
    phone: z.string().trim().regex(/^(\+?91[\s-]?)?[6-9]\d{4}\s?\d{5}$/, "Enter a valid 10-digit mobile number").nullable().or(z.literal("")),
    email: z.string().trim().email("Enter a valid email").nullable().or(z.literal("")),
    birth_year: z.number().int().min(1900).max(yearNow).nullable(),
    anniv_year: z.number().int().min(1900).max(yearNow + 1).nullable(),
  })
  .passthrough();

function DatePartsInput({ label, day, month, year, onChange }: {
  label: string; day: number | null | undefined; month: number | null | undefined; year: number | null | undefined;
  onChange: (d: number | null, m: number | null, y: number | null) => void;
}) {
  return (
    <Field label={label} hint="Year is optional · वर्ष वैकल्पिक है">
      <div className="grid grid-cols-[1fr_1.6fr_1.2fr] gap-2">
        <Select aria-label={`${label} day`} value={day ?? ""} onChange={(e) => onChange(e.target.value ? +e.target.value : null, month ?? null, year ?? null)}>
          <option value="">Day</option>
          {Array.from({ length: 31 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
        </Select>
        <Select aria-label={`${label} month`} value={month ?? ""} onChange={(e) => onChange(day ?? null, e.target.value ? +e.target.value : null, year ?? null)}>
          <option value="">Month</option>
          {MONTHS_EN.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </Select>
        <Input aria-label={`${label} year`} inputMode="numeric" placeholder="Year" value={year ?? ""} maxLength={4}
          onChange={(e) => { const v = e.target.value.replace(/\D/g, ""); onChange(day ?? null, month ?? null, v ? +v : null); }} />
      </div>
    </Field>
  );
}

/**
 * Member editor used both by admins (`admin` = true shows status/visibility/notes)
 * and by members editing their own profile. RLS + triggers decide what is saved.
 */
export function MemberForm({ initial, admin, onSaved, onCancel }: {
  initial: MemberDraft; admin?: boolean; onSaved: (m: Member) => void; onCancel?: () => void;
}) {
  const toast = useToast();
  const [m, setM] = useState<MemberDraft>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const signed = useSignedUrls("gallery", [m.photo_path]);
  const set = <K extends keyof MemberDraft>(k: K, v: MemberDraft[K]) => setM((x) => ({ ...x, [k]: v }));

  async function pickPhoto(f: File | undefined) {
    if (!f) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(f.type)) return toast.error("Please choose a JPG, PNG or WEBP photo");
    if (f.size > 25 * 1024 * 1024) return toast.error("Photo is larger than 25 MB");
    try {
      const blob = await processAvatar(f);
      setPhotoBlob(blob);
      setPhotoPreview(URL.createObjectURL(blob));
    } catch (e) {
      toast.error(e);
    }
  }

  async function save() {
    const parsed = schema.safeParse({ ...m, birth_year: m.birth_year ?? null, anniv_year: m.anniv_year ?? null });
    const errs: Record<string, string> = {};
    if (!parsed.success) for (const i of parsed.error.issues) errs[String(i.path[0])] = i.message;
    if ((m.birth_day == null) !== (m.birth_month == null)) errs.birth = "Choose both day and month";
    if ((m.anniv_day == null) !== (m.anniv_month == null)) errs.anniv = "Choose both day and month";
    setErrors(errs);
    if (Object.keys(errs).length) return toast.error("Please fix the highlighted fields");

    setBusy(true);
    try {
      let photo_path = m.photo_path ?? null;
      if (photoBlob) {
        photo_path = `avatars/${randomName("jpg")}`;
        const up = await supabase.storage.from("gallery").upload(photo_path, photoBlob, { contentType: "image/jpeg" });
        if (up.error) throw up.error;
      }
      const row: Record<string, unknown> = {
        full_name: m.full_name.trim(),
        photo_path,
        birth_day: m.birth_day ?? null, birth_month: m.birth_month ?? null, birth_year: m.birth_year ?? null,
        anniv_day: m.anniv_day ?? null, anniv_month: m.anniv_month ?? null, anniv_year: m.anniv_year ?? null,
        married: m.married ?? null,
        profession: m.profession?.trim() || null,
        bio: m.bio?.trim() || null,
        phone: m.phone?.replace(/[\s-]/g, "").replace(/^\+?91(?=\d{10}$)/, "") || null,
        email: m.email?.trim().toLowerCase() || null,
        address: m.address?.trim() || null,
        show_birthday: m.show_birthday ?? true,
        show_anniversary: m.show_anniversary ?? true,
        show_phone: m.show_phone ?? false,
      };
      if (admin) {
        Object.assign(row, {
          joining_date: m.joining_date || null,
          status: m.status ?? "active",
          is_public: m.is_public ?? false,
          notes: m.notes?.trim() || null,
        });
      }
      const q = m.id
        ? supabase.from("members").update(row).eq("id", m.id).select().single()
        : supabase.from("members").insert(row).select().single();
      const { data, error } = await q;
      if (error) throw error;
      // Remove the previous avatar file once the new one is saved (best effort; admins only by policy).
      if (photoBlob && initial.photo_path && initial.photo_path !== photo_path) {
        await supabase.storage.from("gallery").remove([initial.photo_path]);
      }
      toast.success("सहेजा गया · Saved");
      onSaved(data as Member);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }

  const avatarSrc = photoPreview ?? (m.photo_path ? signed[m.photo_path] : null);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <Avatar name={m.full_name || "?"} src={avatarSrc} size={72} />
        <div>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => pickPhoto(e.target.files?.[0])} />
          <Button variant="secondary" size="sm" icon={<Camera className="h-4 w-4" />} onClick={() => fileRef.current?.click()}>
            फ़ोटो बदलें · Photo
          </Button>
          <p className="mt-1 text-xs text-muted">Cropped to a square automatically.</p>
        </div>
      </div>

      <Field label="पूरा नाम · Full name" required error={errors.full_name}>
        <Input value={m.full_name} onChange={(e) => set("full_name", e.target.value)} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="मोबाइल · Mobile" error={errors.phone}>
          <Input inputMode="tel" value={m.phone ?? ""} onChange={(e) => set("phone", e.target.value)} />
        </Field>
        <Field label="ईमेल · Email" error={errors.email} hint={admin ? "Used to link this member to their login account" : undefined}>
          <Input type="email" value={m.email ?? ""} onChange={(e) => set("email", e.target.value)} />
        </Field>
      </div>
      <DatePartsInput label="जन्मतिथि · Date of birth" day={m.birth_day} month={m.birth_month} year={m.birth_year}
        onChange={(d, mo, y) => setM((x) => ({ ...x, birth_day: d, birth_month: mo, birth_year: y }))} />
      {(errors.birth || errors.birth_year) && <p className="-mt-2 text-xs text-red-600">{errors.birth ?? errors.birth_year}</p>}
      <Field label="विवाहित? · Married?">
        <Select value={m.married == null ? "" : m.married ? "yes" : "no"} onChange={(e) => set("married", e.target.value === "" ? null : e.target.value === "yes")}>
          <option value="">—</option>
          <option value="yes">हाँ · Yes</option>
          <option value="no">नहीं · No</option>
        </Select>
      </Field>
      <DatePartsInput label="शादी की सालगिरह · Anniversary" day={m.anniv_day} month={m.anniv_month} year={m.anniv_year}
        onChange={(d, mo, y) => setM((x) => ({ ...x, anniv_day: d, anniv_month: mo, anniv_year: y }))} />
      {(errors.anniv || errors.anniv_year) && <p className="-mt-2 text-xs text-red-600">{errors.anniv ?? errors.anniv_year}</p>}
      <Field label="व्यवसाय / पद · Profession (optional)">
        <Input value={m.profession ?? ""} onChange={(e) => set("profession", e.target.value)} />
      </Field>
      <Field label="परिचय · Short bio">
        <Textarea value={m.bio ?? ""} maxLength={600} onChange={(e) => set("bio", e.target.value)} />
      </Field>
      <Field label="पता · Address (private)">
        <Input value={m.address ?? ""} onChange={(e) => set("address", e.target.value)} />
      </Field>

      <div className="rounded-2xl bg-white p-4">
        <p className="mb-2 text-sm font-semibold text-forest">गोपनीयता · Privacy</p>
        <Toggle checked={m.show_birthday ?? true} onChange={(v) => set("show_birthday", v)} label="Show my birthday (day & month) to members" hint="Birth year is never shown to other members" />
        <Toggle checked={m.show_anniversary ?? true} onChange={(v) => set("show_anniversary", v)} label="Show my anniversary to members" />
        <Toggle checked={m.show_phone ?? false} onChange={(v) => set("show_phone", v)} label="Show my mobile number to members" hint="Visitors never see phone numbers" />
      </div>

      {admin && (
        <div className="space-y-4 rounded-2xl border border-gold/40 bg-gold-100/40 p-4">
          <p className="text-sm font-semibold text-forest">Admin</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="जुड़ने की तारीख · Joining date">
              <Input type="date" value={m.joining_date ?? ""} onChange={(e) => set("joining_date", e.target.value || null)} />
            </Field>
            <Field label="स्थिति · Status">
              <Select value={m.status ?? "active"} onChange={(e) => set("status", e.target.value as Member["status"])}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </Select>
            </Field>
          </div>
          <Toggle checked={m.is_public ?? false} onChange={(v) => set("is_public", v)} label="Show name & photo on the public website" hint="Dates and contact details stay private" />
          <Field label="नोट्स · Admin notes (not visible to members)">
            <Textarea value={m.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
          </Field>
        </div>
      )}

      <div className="sticky bottom-0 -mx-5 flex justify-end gap-2 border-t border-forest/10 bg-cream-100 px-5 py-3">
        {onCancel && <Button variant="secondary" onClick={onCancel} disabled={busy}>रद्द · Cancel</Button>}
        <Button onClick={save} loading={busy}>सहेजें · Save</Button>
      </div>
    </div>
  );
}
