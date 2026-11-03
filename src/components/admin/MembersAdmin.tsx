"use client";
import { Download, Pencil, Search, Trash2, UserPlus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { MemberForm } from "@/components/members/MemberForm";
import { useToast } from "@/components/toast";
import { Avatar, Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Input, Loading, Modal, Select } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { dayMonthLabel } from "@/lib/dates";
import { downloadXlsx } from "@/lib/excel";
import { useDebounced, useLoad } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import type { Member } from "@/lib/types";
import { useSignedUrls } from "@/lib/useSigned";

export default function MembersAdmin() {
  const toast = useToast();
  const { isSuperAdmin } = useAuth();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "inactive">("all");
  const [editing, setEditing] = useState<Partial<Member> | null>(null);
  const [deleting, setDeleting] = useState<Member | null>(null);
  const [busy, setBusy] = useState(false);
  const dq = useDebounced(q);

  const { data, error, loading, reload, setData } = useLoad(async () => {
    const { data, error } = await supabase.from("members").select("*").order("full_name");
    if (error) throw error;
    return (data ?? []) as Member[];
  });

  // Deep link from a member page: /admin/?tab=members&edit=<id>
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("edit");
    if (id && data) {
      const m = data.find((x) => x.id === id);
      if (m) setEditing(m);
    }
  }, [data]);

  const list = useMemo(() => {
    const t = dq.trim().toLowerCase();
    return (data ?? []).filter((m) =>
      (status === "all" || m.status === status) &&
      (!t || m.full_name.toLowerCase().includes(t) || (m.phone ?? "").includes(t) || (m.email ?? "").toLowerCase().includes(t)));
  }, [data, dq, status]);
  const photos = useSignedUrls("gallery", list.map((m) => m.photo_path));

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    const { error } = await supabase.from("members").delete().eq("id", deleting.id);
    setBusy(false);
    if (error) {
      return toast.error(error.message.includes("foreign key")
        ? "This member has financial records and cannot be deleted. Mark them Inactive instead."
        : error);
    }
    setData((data ?? []).filter((m) => m.id !== deleting.id));
    setDeleting(null);
    toast.success("Member deleted");
  }

  function exportAll() {
    downloadXlsx(`members-${new Date().toISOString().slice(0, 10)}.xlsx`, [{
      name: "Members",
      rows: (data ?? []).map((m) => ({
        "Member No": m.member_no, Name: m.full_name, Mobile: m.phone, Email: m.email,
        "Birth day": m.birth_day, "Birth month": m.birth_month, "Birth year": m.birth_year,
        Married: m.married == null ? "" : m.married ? "Yes" : "No",
        "Anniv day": m.anniv_day, "Anniv month": m.anniv_month, "Anniv year": m.anniv_year,
        Profession: m.profession, "Joining date": m.joining_date, Status: m.status, Public: m.is_public ? "Yes" : "No",
        "Login linked": m.user_id ? "Yes" : "No", Notes: m.notes,
      })),
    }]);
  }

  if (error) return <ErrorState message={error} onRetry={reload} />;

  return (
    <div>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, mobile or email" className="pl-10" aria-label="Search" />
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="sm:w-40" aria-label="Status">
          <option value="all">All</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </Select>
        <Button variant="secondary" onClick={exportAll} icon={<Download className="h-4 w-4" />} disabled={!data?.length}>Excel</Button>
        <Button onClick={() => setEditing({ full_name: "", status: "active", show_birthday: true, show_anniversary: true, show_phone: false, is_public: false })} icon={<UserPlus className="h-4 w-4" />}>
          नया सदस्य · Add
        </Button>
      </div>
      <p className="mb-3 text-sm text-muted">Bulk add from Excel: use the <b>Excel import</b> tab.</p>

      {loading ? <Loading /> : !list.length ? (
        <EmptyState title="कोई सदस्य नहीं" text="Add members one by one or import them from Excel." />
      ) : (
        <div className="space-y-2">
          {list.map((m) => (
            <Card key={m.id} className="flex items-center gap-3 p-3">
              <Avatar name={m.full_name} src={m.photo_path ? photos[m.photo_path] : null} size={44} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-forest">{m.full_name} <span className="text-xs text-muted">#{m.member_no}</span></p>
                <p className="truncate text-xs text-muted">
                  {[m.phone, m.birth_day && m.birth_month ? `🎂 ${dayMonthLabel(m.birth_day, m.birth_month)}${m.birth_year ? ` ${m.birth_year}` : ""}` : null,
                    m.anniv_day && m.anniv_month ? `💐 ${dayMonthLabel(m.anniv_day, m.anniv_month)}${m.anniv_year ? ` ${m.anniv_year}` : ""}` : null]
                    .filter(Boolean).join(" · ") || "No details yet"}
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {m.status === "inactive" && <Badge tone="red">Inactive</Badge>}
                  {m.is_public && <Badge tone="grey">Public</Badge>}
                  {m.user_id ? <Badge tone="green">Login linked</Badge> : <Badge tone="grey">No login</Badge>}
                  {m.notes && <Badge tone="gold" className="max-w-[16rem] truncate" >⚠ {m.notes}</Badge>}
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setEditing(m)} aria-label={`Edit ${m.full_name}`}><Pencil className="h-4 w-4" /></Button>
              {isSuperAdmin && (
                <Button variant="ghost" size="sm" className="text-red-600" onClick={() => setDeleting(m)} aria-label={`Delete ${m.full_name}`}><Trash2 className="h-4 w-4" /></Button>
              )}
            </Card>
          ))}
        </div>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? "सदस्य संपादित करें · Edit member" : "नया सदस्य · New member"} wide>
        {editing && (
          <MemberForm
            admin
            initial={{ ...editing, full_name: editing.full_name ?? "" }}
            onCancel={() => setEditing(null)}
            onSaved={(saved) => {
              const rest = (data ?? []).filter((x) => x.id !== saved.id);
              setData([...rest, saved].sort((a, b) => a.full_name.localeCompare(b.full_name)));
              setEditing(null);
            }}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        title="सदस्य हटाएँ? · Delete member?"
        message={<>Permanently delete <b>{deleting?.full_name}</b>? Their login account (if any) stays but is unlinked. Members with financial records cannot be deleted — mark them inactive instead.</>}
        confirmLabel="हटाएँ · Delete"
        loading={busy}
        onConfirm={remove}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
