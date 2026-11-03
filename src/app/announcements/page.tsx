"use client";
import { Archive, Bell, CheckCheck, Pin, Plus, Search, Share2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, EmptyState, ErrorState, Input, LinkButton, PageHeader, Skeleton, Tabs } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { formatDateTime } from "@/lib/dates";
import { clsx, siteUrl, whatsappUrl } from "@/lib/format";
import { useDebounced, useLoad, useQueryParam } from "@/lib/hooks";
import { publicUrl } from "@/lib/storage";
import { supabase } from "@/lib/supabase";
import type { Announcement } from "@/lib/types";

export default function AnnouncementsPage() {
  const { isMember, isAdmin, user, loading: authLoading } = useAuth();
  const toast = useToast();
  const focusId = useQueryParam("id");
  const [tab, setTab] = useState<"current" | "archive">("current");
  const [q, setQ] = useState("");
  const dq = useDebounced(q);

  const list = useLoad(async () => {
    const { data, error } = await supabase.from("announcements").select("*")
      .order("pinned", { ascending: false }).order("published_at", { ascending: false }).limit(300);
    if (error) throw error;
    return (data ?? []) as Announcement[];
  }, [authLoading, user?.id]);

  const reads = useLoad(async () => {
    if (!isMember || !user) return new Set<string>();
    const { data } = await supabase.from("announcement_reads").select("announcement_id").eq("user_id", user.id);
    return new Set((data ?? []).map((r) => r.announcement_id as string));
  }, [isMember, user?.id]);

  useEffect(() => {
    if (!focusId || list.loading) return;
    setTimeout(() => document.getElementById(`a-${focusId}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
  }, [focusId, list.loading]);

  const now = Date.now();
  const filtered = useMemo(() => {
    const term = dq.trim().toLowerCase();
    return (list.data ?? []).filter((a) => {
      const expired = !!a.expires_at && Date.parse(a.expires_at) <= now;
      if ((tab === "archive") !== expired) return false;
      return !term || a.title.toLowerCase().includes(term) || a.body.toLowerCase().includes(term);
    });
  }, [list.data, dq, tab, now]);

  async function markRead(id: string) {
    const { error } = await supabase.from("announcement_reads").insert({ announcement_id: id });
    if (error && !String(error.message).includes("duplicate")) return toast.error(error);
    reads.setData(new Set([...(reads.data ?? []), id]));
    toast.success("पढ़ लिया · Marked as read");
  }

  function share(a: Announcement) {
    const text = `📢 *${a.title}*\n\n${a.body}\n\n— पाहिल वाटिका योगा ग्रुप\n${siteUrl(`/announcements/?id=${a.id}`)}`;
    window.open(whatsappUrl(text), "_blank", "noopener");
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader hi="सूचना पट" en="Announcements">
        {isAdmin && <LinkButton href="/admin/?tab=announcements" icon={<Plus className="h-4 w-4" />}>नई सूचना · New</LinkButton>}
      </PageHeader>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Tabs value={tab} onChange={setTab} items={[{ value: "current", label: "वर्तमान · Current" }, { value: "archive", label: <span className="inline-flex items-center gap-1"><Archive className="h-4 w-4" /> पुरानी · Archive</span> }]} />
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="खोजें · Search" className="pl-10" aria-label="Search announcements" />
        </div>
      </div>

      {list.error ? <ErrorState message={list.error} onRetry={list.reload} /> : list.loading ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-32" />)}</div>
      ) : !filtered.length ? (
        <EmptyState icon={<Bell className="h-7 w-7" />} title={tab === "archive" ? "कोई पुरानी सूचना नहीं" : "अभी कोई सूचना नहीं"} text={!isMember ? "Members can see more announcements after signing in." : undefined} />
      ) : (
        <div className="space-y-3">
          {filtered.map((a) => {
            const img = publicUrl(a.image_path);
            const read = reads.data?.has(a.id);
            return (
              <Card key={a.id} id={`a-${a.id}`} className={clsx("overflow-hidden scroll-mt-24", focusId === a.id && "ring-2 ring-gold", a.priority === "urgent" && "border-l-4 border-l-red-500", a.priority === "important" && "border-l-4 border-l-gold")}>
                {img && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={img} alt="" className="max-h-80 w-full object-cover" loading="lazy" />
                )}
                <div className="p-5">
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {a.pinned && <Badge tone="gold"><Pin className="h-3 w-3" /> Pinned</Badge>}
                    {a.priority === "urgent" && <Badge tone="red">अति आवश्यक · Urgent</Badge>}
                    {a.priority === "important" && <Badge tone="gold">महत्वपूर्ण · Important</Badge>}
                    {a.visibility === "public" ? <Badge tone="grey">Public</Badge> : <Badge tone="green">Members</Badge>}
                  </div>
                  <h2 className="font-hindi text-xl font-semibold text-forest">{a.title}</h2>
                  <p className="mt-2 whitespace-pre-line text-[15px] leading-relaxed text-forest-900/85">{a.body}</p>
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-muted">
                      {formatDateTime(a.published_at)}
                      {a.expires_at && ` · until ${formatDateTime(a.expires_at)}`}
                    </p>
                    <div className="flex gap-2">
                      {isMember && a.require_read && (read ? (
                        <Badge tone="green"><CheckCheck className="h-3.5 w-3.5" /> पढ़ लिया</Badge>
                      ) : (
                        <Button size="sm" onClick={() => markRead(a.id)} icon={<CheckCheck className="h-4 w-4" />}>पढ़ लिया · Mark read</Button>
                      ))}
                      <Button size="sm" variant="secondary" onClick={() => share(a)} icon={<Share2 className="h-4 w-4" />}>WhatsApp</Button>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
