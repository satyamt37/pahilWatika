"use client";
import { CalendarDays, HardDrive, Images, Clock, UserCheck, Users } from "lucide-react";
import Link from "next/link";
import { Card, ErrorState, Loading, StatCard } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { formatDateTime, todayISO } from "@/lib/dates";
import { bytes } from "@/lib/format";
import { useLoad } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";

const FREE_TIER_BYTES = 1024 ** 3; // Supabase free plan: 1 GB file storage

export default function OverviewAdmin() {
  const { isAdmin } = useAuth();
  const { data, error, loading, reload } = useLoad(async () => {
    const count = async (q: PromiseLike<{ count: number | null; error: unknown }>) => {
      const r = await q;
      if (r.error) throw r.error;
      return r.count ?? 0;
    };
    const head = { count: "exact" as const, head: true };
    const [members, pendingUsers, pendingPhotos, upcoming, photos, usage, recent] = await Promise.all([
      count(supabase.from("member_directory").select("id", head).eq("status", "active")),
      isAdmin ? count(supabase.from("profiles").select("id", head).eq("approved", false)) : Promise.resolve(0),
      isAdmin ? count(supabase.from("photos").select("id", head).eq("status", "pending").is("deleted_at", null)) : Promise.resolve(0),
      count(supabase.from("events").select("id", head).gte("event_date", todayISO()).neq("status", "cancelled")),
      count(supabase.from("photos").select("id", head).is("deleted_at", null)),
      isAdmin ? supabase.rpc("storage_usage").then((r) => r.data as { bytes: number; objects: number } | null) : Promise.resolve(null),
      isAdmin ? supabase.from("audit_log").select("id,table_name,action,at").order("at", { ascending: false }).limit(8).then((r) => r.data ?? []) : Promise.resolve([]),
    ]);
    return { members, pendingUsers, pendingPhotos, upcoming, photos, usage, recent };
  }, [isAdmin]);

  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (loading || !data) return <Loading />;
  const pct = data.usage ? Math.min(100, (data.usage.bytes / FREE_TIER_BYTES) * 100) : 0;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
        <StatCard label="Active members" value={data.members} icon={<Users className="h-5 w-5" />} />
        <StatCard label="Photos & videos" value={data.photos} icon={<Images className="h-5 w-5" />} tone="gold" />
        <StatCard label="Upcoming events" value={data.upcoming} icon={<CalendarDays className="h-5 w-5" />} tone="forest" />
        {isAdmin && (
          <Link href="/admin/?tab=roles">
            <StatCard label="Accounts to approve" value={data.pendingUsers} icon={<UserCheck className="h-5 w-5" />} tone={data.pendingUsers ? "red" : "green"} />
          </Link>
        )}
        {isAdmin && (
          <Link href="/admin/?tab=photos">
            <StatCard label="Photos awaiting approval" value={data.pendingPhotos} icon={<Clock className="h-5 w-5" />} tone={data.pendingPhotos ? "red" : "green"} />
          </Link>
        )}
      </div>

      {data.usage && (
        <Card className="p-5">
          <div className="flex items-center gap-3">
            <HardDrive className="h-5 w-5 text-leaf" />
            <p className="font-semibold text-forest">Storage used · स्टोरेज</p>
          </div>
          <div className="mt-3 h-3 overflow-hidden rounded-full bg-cream-200">
            <div className={pct > 85 ? "h-full bg-red-500" : "h-full bg-leaf"} style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-2 text-sm text-muted">
            {bytes(data.usage.bytes)} of 1 GB free tier ({pct.toFixed(1)}%) · {data.usage.objects} files.
            {pct > 85 && " Consider emptying the photo trash, turning off 'keep originals', or moving videos to YouTube."}
          </p>
        </Card>
      )}

      {data.recent.length > 0 && (
        <Card className="p-5">
          <p className="mb-3 font-semibold text-forest">Recent activity</p>
          <ul className="divide-y divide-forest/5 text-sm">
            {data.recent.map((r) => (
              <li key={r.id} className="flex justify-between gap-3 py-2">
                <span><b className="capitalize">{r.action}</b> · {r.table_name.replace(/_/g, " ")}</span>
                <span className="text-muted">{formatDateTime(r.at)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
