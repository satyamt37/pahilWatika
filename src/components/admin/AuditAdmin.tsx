"use client";
import { useState } from "react";
import { Badge, Button, Card, EmptyState, ErrorState, Loading, Modal, Select } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { formatDateTime } from "@/lib/dates";
import { useLoad } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";

interface Entry {
  id: number;
  table_name: string;
  record_id: string | null;
  action: string;
  actor: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  at: string;
}

const PAGE = 50;
const TABLES = ["members", "profiles", "albums", "photos", "events", "announcements", "site_settings", "theme_song", "fin_contribution_rules", "fin_categories", "greeting_templates", "thoughts"];

/** Keys whose values differ between old and new (ignores timestamps). */
function changedKeys(e: Entry): string[] {
  if (!e.old_data || !e.new_data) return [];
  return Object.keys(e.new_data).filter((k) => k !== "updated_at" && JSON.stringify(e.old_data![k]) !== JSON.stringify(e.new_data![k]));
}

export default function AuditAdmin() {
  const { isAdmin } = useAuth();
  const [table, setTable] = useState("");
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<Entry | null>(null);

  const { data, error, loading, reload } = useLoad(async () => {
    let q = supabase.from("audit_log").select("*").order("at", { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1);
    if (table) q = q.eq("table_name", table);
    const { data, error } = await q;
    if (error) throw error;
    const rows = (data ?? []) as Entry[];
    const actorIds = [...new Set(rows.map((r) => r.actor).filter(Boolean))] as string[];
    const { data: names } = actorIds.length ? await supabase.from("user_names").select("id,name").in("id", actorIds) : { data: [] };
    return { rows, names: Object.fromEntries((names ?? []).map((n) => [n.id, n.name])) as Record<string, string> };
  }, [table, page]);

  if (!isAdmin) {
    return <p className="rounded-xl bg-white p-4 text-sm text-muted">Financial audit history is in the <b>Hisaab-Kitab</b> tab → Audit history.</p>;
  }
  if (error) return <ErrorState message={error} onRetry={reload} />;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select value={table} onChange={(e) => { setTable(e.target.value); setPage(0); }} className="w-56" aria-label="Filter by area">
          <option value="">All areas</option>
          {TABLES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
        </Select>
        <p className="text-xs text-muted">Every change to content and settings is recorded automatically. Financial changes have their own audit trail in Hisaab-Kitab.</p>
      </div>
      {loading || !data ? <Loading /> : !data.rows.length ? <EmptyState title="No activity yet" /> : (
        <Card className="divide-y divide-forest/5">
          {data.rows.map((e) => {
            const keys = changedKeys(e);
            const label = (e.new_data?.full_name ?? e.new_data?.title ?? e.new_data?.name ?? e.old_data?.full_name ?? e.old_data?.title ?? e.record_id) as string;
            return (
              <button key={e.id} onClick={() => setOpen(e)} className="flex w-full items-start justify-between gap-3 p-3 text-left text-sm hover:bg-cream-100">
                <span className="min-w-0">
                  <Badge tone={e.action === "delete" ? "red" : e.action === "insert" ? "green" : "gold"}>{e.action}</Badge>{" "}
                  <b className="text-forest">{e.table_name.replace(/_/g, " ")}</b> · <span className="break-all">{String(label ?? "")}</span>
                  {keys.length > 0 && <span className="block truncate text-xs text-muted">changed: {keys.join(", ")}</span>}
                </span>
                <span className="shrink-0 text-right text-xs text-muted">
                  {formatDateTime(e.at)}<br />{e.actor ? data.names[e.actor] ?? "user" : "system"}
                </span>
              </button>
            );
          })}
        </Card>
      )}
      <div className="mt-3 flex justify-between">
        <Button variant="secondary" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>← Newer</Button>
        <Button variant="secondary" size="sm" disabled={(data?.rows.length ?? 0) < PAGE} onClick={() => setPage(page + 1)}>Older →</Button>
      </div>

      <Modal open={!!open} onClose={() => setOpen(null)} title="Change details" wide>
        {open && (
          <div className="space-y-3 text-sm">
            <p><b>{open.action}</b> on {open.table_name} · {formatDateTime(open.at)}</p>
            <table className="w-full text-left text-xs">
              <thead><tr className="text-muted"><th className="py-1 pr-2">Field</th><th className="py-1 pr-2">Before</th><th className="py-1">After</th></tr></thead>
              <tbody>
                {[...new Set([...Object.keys(open.old_data ?? {}), ...Object.keys(open.new_data ?? {})])].map((k) => {
                  const b = JSON.stringify(open.old_data?.[k] ?? null);
                  const a = JSON.stringify(open.new_data?.[k] ?? null);
                  return (
                    <tr key={k} className={b !== a ? "bg-gold-100/60" : ""}>
                      <td className="py-1 pr-2 font-medium align-top">{k}</td>
                      <td className="max-w-[12rem] break-all py-1 pr-2 align-top">{open.old_data ? b : "—"}</td>
                      <td className="max-w-[12rem] break-all py-1 align-top">{open.new_data ? a : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </div>
  );
}
