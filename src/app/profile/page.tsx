"use client";
import { KeyRound, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Guard } from "@/components/Guard";
import { MemberForm } from "@/components/members/MemberForm";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, Loading, PageHeader } from "@/components/ui";
import { ROLE_LABELS, useAuth } from "@/lib/auth";
import { useLoad } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import type { Member } from "@/lib/types";

export default function ProfilePage() {
  return (
    <Guard need="signed_in">
      <ProfileInner />
    </Guard>
  );
}

function ProfileInner() {
  const auth = useAuth();
  const toast = useToast();
  const router = useRouter();
  const [displayName, setDisplayName] = useState(auth.profile?.display_name ?? "");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState<"name" | "pw" | null>(null);

  const member = useLoad(async () => {
    const { data, error } = await supabase.from("members").select("*").eq("user_id", auth.user!.id).maybeSingle();
    if (error) throw error;
    return data as Member | null;
  }, [auth.user?.id]);

  async function saveName() {
    if (displayName.trim().length < 2) return toast.error("Name is too short");
    setBusy("name");
    const { error } = await supabase.from("profiles").update({ display_name: displayName.trim() }).eq("id", auth.user!.id);
    setBusy(null);
    if (error) return toast.error(error);
    await auth.refreshProfile();
    toast.success("सहेजा गया · Saved");
  }

  async function changePassword() {
    if (pw.length < 8) return toast.error("Password must be at least 8 characters");
    setBusy("pw");
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(null);
    if (error) return toast.error(error);
    setPw("");
    toast.success("Password changed · पासवर्ड बदल गया");
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader hi="मेरी प्रोफ़ाइल" en="My profile" />
      <Card className="space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted">{auth.user?.email}</span>
          <Badge tone={auth.role ? "green" : "gold"}>{auth.role ? ROLE_LABELS[auth.role] : "Awaiting approval"}</Badge>
        </div>
        <Field label="प्रदर्शित नाम · Display name">
          <div className="flex gap-2">
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            <Button onClick={saveName} loading={busy === "name"}>सहेजें</Button>
          </div>
        </Field>
        <Field label="नया पासवर्ड · New password" hint="At least 8 characters">
          <div className="flex gap-2">
            <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
            <Button variant="secondary" onClick={changePassword} loading={busy === "pw"} icon={<KeyRound className="h-4 w-4" />}>बदलें</Button>
          </div>
        </Field>
        <Button variant="ghost" className="text-red-700" icon={<LogOut className="h-4 w-4" />} onClick={async () => { await auth.signOut(); router.replace("/"); }}>
          लॉग आउट · Sign out
        </Button>
      </Card>

      <Card className="p-5">
        <h2 className="mb-4 font-hindi text-lg font-semibold text-forest">सदस्य प्रोफ़ाइल · Member details</h2>
        {member.error ? <ErrorState message={member.error} onRetry={member.reload} /> : member.loading ? <Loading /> : !member.data ? (
          <EmptyState
            title="प्रोफ़ाइल जुड़ी नहीं है"
            text="Your login is not linked to a member profile yet. An admin can link it from Admin → Users & roles, or add your email to your member record."
          />
        ) : !auth.perms.members_edit_own_profile && !auth.isAdmin ? (
          <p className="text-sm text-muted">Profile editing is currently disabled by the administrator.</p>
        ) : (
          <MemberForm initial={member.data} admin={auth.isAdmin} onSaved={(m) => member.setData(m)} />
        )}
      </Card>
    </div>
  );
}
