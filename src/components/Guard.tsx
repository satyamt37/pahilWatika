"use client";
import { Lock } from "lucide-react";
import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { EmptyState, LinkButton, Loading } from "./ui";
import { BASE_PATH } from "@/lib/supabase";

type Need = "signed_in" | "member" | "admin" | "treasurer" | "staff" | "super_admin" | "finance";

/**
 * Hides a page from people who lack the role. This is a UX convenience only —
 * the database refuses the same requests through RLS regardless of the UI.
 */
export function Guard({ need, children }: { need: Need; children: ReactNode }) {
  const a = useAuth();
  if (a.loading) return <Loading />;
  const ok = {
    signed_in: !!a.user,
    member: a.isMember,
    admin: a.isAdmin,
    treasurer: a.isTreasurer,
    staff: a.isAdmin || a.isTreasurer,
    super_admin: a.isSuperAdmin,
    finance: a.canSeeFinance,
  }[need];
  if (ok) return <>{children}</>;
  if (!a.user) {
    const next = typeof window !== "undefined" ? window.location.pathname.replace(BASE_PATH, "") + window.location.search : "/";
    return (
      <EmptyState
        icon={<Lock className="h-7 w-7" />}
        title="कृपया लॉगिन करें"
        text="This section is for Pahil Vatika parivaar members. Please sign in to continue."
        action={<LinkButton href={`/login/?next=${encodeURIComponent(next)}`}>लॉगिन · Sign in</LinkButton>}
      />
    );
  }
  return (
    <EmptyState
      icon={<Lock className="h-7 w-7" />}
      title="अनुमति नहीं है"
      text={a.profile && !a.profile.approved
        ? "Your account is awaiting approval by an administrator."
        : "You don't have permission to view this section."}
    />
  );
}
