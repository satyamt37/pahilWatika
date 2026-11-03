"use client";
import { Check, ShieldCheck, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Loading, Select } from "@/components/ui";
import { ROLE_LABELS, useAuth } from "@/lib/auth";
import { formatDateTime } from "@/lib/dates";
import { useLoad } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import type { Member, Profile, Role } from "@/lib/types";

const MATRIX: [string, boolean, boolean, boolean, boolean, boolean][] = [
  // capability, super_admin, admin, treasurer, member, visitor
  ["View public content", true, true, true, true, true],
  ["View members, private photos, events RSVP", true, true, true, true, false],
  ["Upload photos (if enabled)", true, true, true, true, false],
  ["Manage events, albums, photos, announcements", true, true, false, false, false],
  ["Manage member profiles", true, true, false, false, false],
  ["View finance (if enabled for members)", true, false, true, true, false],
  ["Record contributions / expenses / receipts", true, false, true, false, false],
  ["Change roles, delete members", true, false, false, false, false],
];

export default function RolesAdmin() {
  const toast = useToast();
  const { isSuperAdmin, user } = useAuth();
  const [confirm, setConfirm] = useState<{ p: Profile; role: Role } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const { data, error, loading, reload, setData } = useLoad(async () => {
    const [p, m] = await Promise.all([
      supabase.from("profiles").select("*").order("approved").order("created_at", { ascending: false }),
      supabase.from("members").select("id,full_name,user_id,email").order("full_name"),
    ]);
    if (p.error) throw p.error;
    if (m.error) throw m.error;
    return { profiles: (p.data ?? []) as Profile[], members: (m.data ?? []) as Pick<Member, "id" | "full_name" | "user_id" | "email">[] };
  });

  const pending = useMemo(() => (data?.profiles ?? []).filter((p) => !p.approved), [data]);
  const approved = useMemo(() => (data?.profiles ?? []).filter((p) => p.approved), [data]);

  function patchLocal(id: string, patch: Partial<Profile>) {
    if (!data) return;
    setData({ ...data, profiles: data.profiles.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  }

  async function setApproved(p: Profile, approved: boolean) {
    setBusy(p.id);
    const { error } = await supabase.from("profiles").update({ approved }).eq("id", p.id);
    setBusy(null);
    if (error) return toast.error(error);
    patchLocal(p.id, { approved });
    toast.success(approved ? "Account approved · स्वीकृत" : "Access removed");
  }

  async function link(p: Profile, memberId: string) {
    if (!data) return;
    setBusy(p.id);
    try {
      // Unlink the previous member, link the new one, then point the profile at it.
      if (p.member_id) {
        const r = await supabase.from("members").update({ user_id: null }).eq("id", p.member_id);
        if (r.error) throw r.error;
      }
      if (memberId) {
        const r = await supabase.from("members").update({ user_id: p.id }).eq("id", memberId);
        if (r.error) throw r.error;
      }
      const r = await supabase.from("profiles").update({ member_id: memberId || null }).eq("id", p.id);
      if (r.error) throw r.error;
      setData({
        profiles: data.profiles.map((x) => (x.id === p.id ? { ...x, member_id: memberId || null } : x)),
        members: data.members.map((m) => (m.id === memberId ? { ...m, user_id: p.id } : m.id === p.member_id ? { ...m, user_id: null } : m)),
      });
      toast.success("Linked · जोड़ा गया");
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  }

  async function changeRole() {
    if (!confirm) return;
    setBusy(confirm.p.id);
    const { error } = await supabase.from("profiles").update({ role: confirm.role }).eq("id", confirm.p.id);
    setBusy(null);
    if (error) return toast.error(error);
    patchLocal(confirm.p.id, { role: confirm.role });
    setConfirm(null);
    toast.success("Role updated");
  }

  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (loading || !data) return <Loading />;

  const memberOptions = (p: Profile) => data.members.filter((m) => !m.user_id || m.user_id === p.id);
  const Row = ({ p }: { p: Profile }) => (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-forest">{p.display_name}</p>
          <p className="truncate text-sm text-muted">{p.email} · joined {formatDateTime(p.created_at)}</p>
        </div>
        <div className="flex items-center gap-2">
          {p.approved ? <Badge tone="green">{ROLE_LABELS[p.role]}</Badge> : <Badge tone="gold">Pending</Badge>}
        </div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
        <Select value={p.member_id ?? ""} onChange={(e) => link(p, e.target.value)} disabled={busy === p.id} aria-label="Linked member">
          <option value="">— Not linked to a member —</option>
          {memberOptions(p).map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
        </Select>
        {isSuperAdmin && p.approved && (
          <Select value={p.role} onChange={(e) => setConfirm({ p, role: e.target.value as Role })} disabled={busy === p.id || p.id === user?.id} aria-label="Role">
            {(Object.keys(ROLE_LABELS) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </Select>
        )}
        {p.approved ? (
          p.id !== user?.id && <Button variant="secondary" size="md" onClick={() => setApproved(p, false)} loading={busy === p.id} icon={<X className="h-4 w-4" />}>Revoke</Button>
        ) : (
          <Button onClick={() => setApproved(p, true)} loading={busy === p.id} icon={<Check className="h-4 w-4" />}>Approve</Button>
        )}
      </div>
    </Card>
  );

  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-2 font-semibold text-forest">स्वीकृति प्रतीक्षित · Waiting for approval ({pending.length})</h3>
        {pending.length ? <div className="space-y-2">{pending.map((p) => <Row key={p.id} p={p} />)}</div> : (
          <p className="rounded-xl bg-white p-4 text-sm text-muted">No pending accounts. People whose email matches a member record are approved automatically.</p>
        )}
      </section>
      <section>
        <h3 className="mb-2 font-semibold text-forest">सक्रिय खाते · Active accounts ({approved.length})</h3>
        {approved.length ? <div className="space-y-2">{approved.map((p) => <Row key={p.id} p={p} />)}</div> : <EmptyState title="No accounts" />}
        {!isSuperAdmin && <p className="mt-2 text-xs text-muted">Only a Super Admin can change roles.</p>}
      </section>
      <section>
        <h3 className="mb-2 flex items-center gap-2 font-semibold text-forest"><ShieldCheck className="h-4 w-4" /> Permission matrix</h3>
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-forest/10 text-left text-xs uppercase text-muted">
                <th className="p-3">Capability</th><th className="p-3">Super</th><th className="p-3">Admin</th><th className="p-3">Treasurer</th><th className="p-3">Member</th><th className="p-3">Visitor</th>
              </tr>
            </thead>
            <tbody>
              {MATRIX.map(([cap, ...cells]) => (
                <tr key={cap} className="border-b border-forest/5 last:border-0">
                  <td className="p-3 text-forest">{cap}</td>
                  {cells.map((c, i) => <td key={i} className="p-3">{c ? "✅" : "—"}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <p className="mt-2 text-xs text-muted">Enforced in the database (row-level security), not just in the app. Admin + treasurer can be combined by making the person Super Admin.</p>
      </section>

      <ConfirmDialog open={!!confirm} title="भूमिका बदलें? · Change role?" danger={false}
        message={<>Make <b>{confirm?.p.display_name}</b> a <b>{confirm && ROLE_LABELS[confirm.role]}</b>?</>}
        confirmLabel="Change role" loading={!!busy} onConfirm={changeRole} onCancel={() => setConfirm(null)} />
    </div>
  );
}
