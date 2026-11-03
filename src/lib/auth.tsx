"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { isConfigured, supabase } from "./supabase";
import type { HisaabSettings, Permissions, Profile, Role, SiteSettings } from "./types";

export const DEFAULT_SITE: SiteSettings = {
  name_hi: "पाहिल वाटिका योगा ग्रुप, खजुराहो",
  name_en: "Pahil Vatika Yoga Group, Khajuraho",
  family_hi: "पाहिल वाटिका योग परिवार",
  tagline: "एक परिवार, एक पहचान।",
  subtagline: "योग से स्वास्थ्य, साथ से खुशियाँ।",
  message: "यह सिर्फ एक योगा ग्रुप नहीं, हमारा अपना परिवार है।",
  intro: "",
  hero_path: null,
  group_photo_path: null,
  contact_phone: "",
  contact_email: "",
  address: "पाहिल वाटिका, खजुराहो, मध्य प्रदेश",
  session_time: "",
  whatsapp_group: "",
};
export const DEFAULT_PERMS: Permissions = {
  members_can_upload: true,
  photos_need_approval: false,
  keep_originals: false,
  uploads_per_hour: 200,
  max_batch: 30,
  max_image_mb: 25,
  max_video_mb: 50,
  finance_visible_to_members: true,
  members_edit_own_profile: true,
  allow_comments: true,
};
export const DEFAULT_HISAAB: HisaabSettings = {
  legacy_url: "https://resilient-koala-m1f4xi-dev-ed.trailblaze.my.site.com/credit-debit",
  legacy_name: "Hisaab-Kitab (Salesforce)",
  currency: "INR",
};

interface AuthState {
  loading: boolean;
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  /** Approved role, or null for visitors / accounts awaiting approval. UI hint only — RLS is the real gate. */
  role: Role | null;
  isMember: boolean;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  isTreasurer: boolean;
  canSeeFinance: boolean;
  site: SiteSettings;
  perms: Permissions;
  hisaab: HisaabSettings;
  refreshProfile: () => Promise<void>;
  refreshSettings: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthCtx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(isConfigured);
  const [site, setSite] = useState(DEFAULT_SITE);
  const [perms, setPerms] = useState(DEFAULT_PERMS);
  const [hisaab, setHisaab] = useState(DEFAULT_HISAAB);

  const loadProfile = useCallback(async (uid: string | undefined) => {
    if (!uid) return setProfile(null);
    const { data } = await supabase.from("profiles").select("*").eq("id", uid).maybeSingle();
    setProfile((data as Profile) ?? null);
  }, []);

  const refreshSettings = useCallback(async () => {
    if (!isConfigured) return;
    const { data } = await supabase.from("site_settings").select("key,value");
    for (const row of data ?? []) {
      if (row.key === "site") setSite({ ...DEFAULT_SITE, ...(row.value as object) });
      if (row.key === "permissions") setPerms({ ...DEFAULT_PERMS, ...(row.value as object) });
      if (row.key === "hisaab") setHisaab({ ...DEFAULT_HISAAB, ...(row.value as object) });
    }
  }, []);

  useEffect(() => {
    if (!isConfigured) return;
    let active = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session);
      await Promise.all([loadProfile(data.session?.user.id), refreshSettings()]);
      if (active) setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => {
      setSession(s);
      // Defer the query so it doesn't run inside the auth callback lock.
      setTimeout(() => loadProfile(s?.user.id), 0);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile, refreshSettings]);

  const value = useMemo<AuthState>(() => {
    const role = profile?.approved ? profile.role : null;
    const isTreasurer = role === "super_admin" || role === "treasurer";
    return {
      loading,
      session,
      user: session?.user ?? null,
      profile,
      role,
      isMember: role !== null,
      isAdmin: role === "super_admin" || role === "admin",
      isSuperAdmin: role === "super_admin",
      isTreasurer,
      canSeeFinance: isTreasurer || (role !== null && perms.finance_visible_to_members),
      site,
      perms,
      hisaab,
      refreshProfile: () => loadProfile(session?.user.id),
      refreshSettings,
      signOut: async () => {
        await supabase.auth.signOut();
        setProfile(null);
      },
    };
  }, [loading, session, profile, site, perms, hisaab, loadProfile, refreshSettings]);

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  treasurer: "Treasurer",
  member: "Member",
};
