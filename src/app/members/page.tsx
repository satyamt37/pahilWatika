"use client";
import { CakeSlice, Heart, Search, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Avatar, Card, EmptyState, ErrorState, Input, LinkButton, PageHeader, Select, Skeleton } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { dayMonthLabel, nextOccurrence } from "@/lib/dates";
import { useDebounced, useLoad } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import type { DirectoryMember } from "@/lib/types";
import { useSignedUrls } from "@/lib/useSigned";

type Sort = "az" | "za" | "birthday" | "joined";

export default function MembersPage() {
  const { isMember, isAdmin, loading: authLoading, user } = useAuth();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("az");
  const dq = useDebounced(q);

  const { data, error, loading, reload } = useLoad(async () => {
    const { data, error } = await supabase.from("member_directory").select("*").order("full_name");
    if (error) throw error;
    return (data ?? []) as DirectoryMember[];
  }, [authLoading, user?.id]);

  const list = useMemo(() => {
    const term = dq.trim().toLowerCase();
    const rows = (data ?? []).filter((m) => !term || m.full_name.toLowerCase().includes(term) || (m.profession ?? "").toLowerCase().includes(term));
    const byBirthday = (m: DirectoryMember) => (m.birth_month && m.birth_day ? nextOccurrence(m.birth_month, m.birth_day).daysUntil : 9999);
    return [...rows].sort((a, b) =>
      sort === "az" ? a.full_name.localeCompare(b.full_name, "hi")
        : sort === "za" ? b.full_name.localeCompare(a.full_name, "hi")
          : sort === "birthday" ? byBirthday(a) - byBirthday(b)
            : (a.joining_date ?? "9999").localeCompare(b.joining_date ?? "9999"),
    );
  }, [data, dq, sort]);

  const photos = useSignedUrls("gallery", list.map((m) => m.photo_path));

  return (
    <div>
      <PageHeader hi="हमारा परिवार" en="Member directory">
        {isAdmin && <LinkButton href="/admin/?tab=members" icon={<UserPlus className="h-4 w-4" />}>सदस्य जोड़ें · Add member</LinkButton>}
      </PageHeader>

      <div className="mb-5 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="नाम खोजें · Search by name" className="pl-10" aria-label="Search members" />
        </div>
        <Select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="sm:w-56" aria-label="Sort">
          <option value="az">नाम A → Z</option>
          <option value="za">नाम Z → A</option>
          {isMember && <option value="birthday">अगला जन्मदिन · Next birthday</option>}
          {isMember && <option value="joined">जुड़ने का क्रम · Joining date</option>}
        </Select>
      </div>

      {!isMember && !authLoading && (
        <p className="mb-4 rounded-xl bg-white px-4 py-3 text-sm text-muted">
          Visitors see only members who chose to appear publicly. <Link href="/login/" className="font-medium text-leaf-700 underline">Sign in</Link> to see the whole parivaar.
        </p>
      )}

      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : !list.length ? (
        <EmptyState icon={<Users className="h-7 w-7" />} title={q ? "कोई सदस्य नहीं मिला" : "अभी कोई सदस्य नहीं"} text={q ? "Try a different name." : "Members will appear here once added by an admin."} />
      ) : (
        <>
          <p className="mb-3 text-sm text-muted">{list.length} सदस्य · members</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((m) => {
              const bd = m.birth_month && m.birth_day ? nextOccurrence(m.birth_month, m.birth_day) : null;
              return (
                <Link key={m.id} href={`/members/view/?id=${m.id}`} className="group">
                  <Card className="flex items-center gap-4 p-4 transition group-hover:shadow-lift">
                    <Avatar name={m.full_name} src={m.photo_path ? photos[m.photo_path] : null} size={60} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-forest">{m.full_name}</p>
                      {m.profession && <p className="truncate text-sm text-muted">{m.profession}</p>}
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-leaf-700">
                        {bd && (
                          <span className="inline-flex items-center gap-1">
                            <CakeSlice className="h-3.5 w-3.5" /> {dayMonthLabel(m.birth_day!, m.birth_month!)}
                            {bd.daysUntil === 0 && <b className="text-gold-700"> · आज!</b>}
                          </span>
                        )}
                        {m.anniv_month && m.anniv_day && (
                          <span className="inline-flex items-center gap-1"><Heart className="h-3.5 w-3.5" /> {dayMonthLabel(m.anniv_day, m.anniv_month)}</span>
                        )}
                        {m.status === "inactive" && <span className="text-red-600">Inactive</span>}
                      </div>
                    </div>
                  </Card>
                </Link>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
