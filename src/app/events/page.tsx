"use client";
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Countdown, EventCard } from "@/components/events/shared";
import { Card, EmptyState, ErrorState, LinkButton, Loading, PageHeader, Tabs } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { MONTHS_EN, MONTHS_HI, celebrationsInMonth, daysInMonth, formatDate, todayIST, todayISO, ymd } from "@/lib/dates";
import { clsx } from "@/lib/format";
import { must, setQueryParam, useLoad } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import { EVENT_CATEGORIES, type DirectoryMember, type EventCategory, type EventRow } from "@/lib/types";

type Tab = "upcoming" | "past" | "calendar";

export default function EventsPage() {
  const { isAdmin } = useAuth();
  const [tab, setTab] = useState<Tab>("upcoming");
  const [cat, setCat] = useState<EventCategory | "all">("all");

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t === "past" || t === "calendar" || t === "upcoming") setTab(t);
  }, []);
  const choose = (t: Tab) => {
    setTab(t);
    setQueryParam("tab", t === "upcoming" ? null : t);
  };

  return (
    <div>
      <PageHeader hi="कार्यक्रम" en="Events & calendar">
        {isAdmin && <LinkButton href="/admin/?tab=events" icon={<Plus className="h-4 w-4" />}>नया कार्यक्रम · New event</LinkButton>}
      </PageHeader>
      <Tabs<Tab>
        value={tab}
        onChange={choose}
        items={[
          { value: "upcoming", label: "आगामी · Upcoming" },
          { value: "past", label: "पिछले · Past" },
          { value: "calendar", label: "कैलेंडर · Calendar" },
        ]}
      />
      {tab !== "calendar" && (
        <div className="no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1">
          {(["all", ...Object.keys(EVENT_CATEGORIES)] as (EventCategory | "all")[]).map((c) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              className={clsx(
                "h-9 shrink-0 rounded-full border px-3 text-sm transition-colors",
                cat === c ? "border-leaf bg-leaf text-white" : "border-forest/10 bg-white text-forest hover:border-leaf/50",
              )}
            >
              {c === "all" ? "सभी · All" : `${EVENT_CATEGORIES[c].emoji} ${EVENT_CATEGORIES[c].hi}`}
            </button>
          ))}
        </div>
      )}
      <div className="mt-5">
        {tab === "upcoming" && <EventList past={false} cat={cat} />}
        {tab === "past" && <EventList past cat={cat} />}
        {tab === "calendar" && <CalendarView />}
      </div>
    </div>
  );
}

const PAGE = 24;

function EventList({ past, cat }: { past: boolean; cat: EventCategory | "all" }) {
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => setLimit(PAGE), [past, cat]);
  const { data, error, loading, reload } = useLoad(async () => {
    const today = todayISO();
    let q = supabase.from("events").select("*");
    q = past ? q.lt("event_date", today) : q.gte("event_date", today);
    if (cat !== "all") q = q.eq("category", cat);
    q = q.order("event_date", { ascending: !past }).order("start_time", { ascending: !past, nullsFirst: !past }).limit(limit + 1);
    return must(await q) as EventRow[];
  }, [past, cat, limit]);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  const rows = (data ?? []).slice(0, limit);
  if (!rows.length) {
    return (
      <EmptyState
        icon={<CalendarDays className="h-7 w-7" />}
        title={past ? "कोई पिछला कार्यक्रम नहीं" : "अभी कोई आगामी कार्यक्रम नहीं"}
        text={past ? "Past events will be archived here automatically." : "New events will appear here as soon as they are announced."}
      />
    );
  }
  const next = !past ? rows.find((e) => e.status === "scheduled") : undefined;
  return (
    <div className="space-y-4">
      {next && (
        <Card className="bg-forest p-4 text-white sm:p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-gold">अगला कार्यक्रम · Next up</p>
          <p className="mt-1 font-hindi text-xl font-semibold">{next.title}</p>
          <p className="mb-3 text-sm text-white/75">{formatDate(next.event_date)}</p>
          <Countdown date={next.event_date} time={next.start_time} dark />
        </Card>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {rows.map((e) => <EventCard key={e.id} e={e} past={past} />)}
      </div>
      {(data?.length ?? 0) > limit && (
        <div className="text-center">
          <button className="h-11 rounded-xl bg-white px-5 text-sm font-medium text-forest shadow-sm hover:bg-cream-200" onClick={() => setLimit((l) => l + PAGE)}>
            और दिखाएँ · Show more
          </button>
        </div>
      )}
    </div>
  );
}

const WEEKDAYS = ["सोम", "मंगल", "बुध", "गुरु", "शुक्र", "शनि", "रवि"];

function CalendarView() {
  const t = todayIST();
  const { isMember } = useAuth();
  const [ym, setYm] = useState({ y: t.y, m: t.m });
  const [selected, setSelected] = useState<string>(todayISO());
  const first = ymd(ym.y, ym.m, 1);
  const last = ymd(ym.y, ym.m, daysInMonth(ym.y, ym.m));

  const { data, error, loading, reload } = useLoad(async () => {
    const [ev, mem] = await Promise.all([
      supabase.from("events").select("*").gte("event_date", first).lte("event_date", last).order("start_time", { nullsFirst: true }),
      isMember
        ? supabase.from("member_directory").select("id,full_name,birth_day,birth_month,birth_year,anniv_day,anniv_month,anniv_year")
        : Promise.resolve({ data: [], error: null }),
    ]);
    return { events: must(ev) as EventRow[], members: (must(mem) ?? []) as DirectoryMember[] };
  }, [first, last, isMember]);

  const byDay = useMemo(() => {
    const map = new Map<number, EventRow[]>();
    for (const e of data?.events ?? []) {
      const d = Number(e.event_date.slice(8, 10));
      map.set(d, [...(map.get(d) ?? []), e]);
    }
    return map;
  }, [data]);
  const celebs = useMemo(() => {
    const map = new Map<number, ReturnType<typeof celebrationsInMonth<DirectoryMember>>>();
    for (const c of celebrationsInMonth(data?.members ?? [], ym.y, ym.m)) map.set(c.day, [...(map.get(c.day) ?? []), c]);
    return map;
  }, [data, ym]);

  const shift = (n: number) => {
    const d = new Date(Date.UTC(ym.y, ym.m - 1 + n, 1));
    setYm({ y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 });
  };
  // Monday-first offset
  const offset = (new Date(Date.UTC(ym.y, ym.m - 1, 1)).getUTCDay() + 6) % 7;
  const days = daysInMonth(ym.y, ym.m);
  const today = todayISO();
  const selDay = selected.startsWith(`${ym.y}-${String(ym.m).padStart(2, "0")}`) ? Number(selected.slice(8, 10)) : null;
  const dayEvents = selDay ? byDay.get(selDay) ?? [] : [];
  const dayCelebs = selDay ? celebs.get(selDay) ?? [] : [];

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
      <Card className="p-3 sm:p-5">
        <div className="mb-3 flex items-center justify-between">
          <button onClick={() => shift(-1)} className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-forest/5" aria-label="Previous month"><ChevronLeft className="h-5 w-5" /></button>
          <div className="text-center">
            <p className="font-hindi text-lg font-semibold text-forest">{MONTHS_HI[ym.m - 1]} {ym.y}</p>
            <p className="text-xs text-muted">{MONTHS_EN[ym.m - 1]}</p>
          </div>
          <button onClick={() => shift(1)} className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-forest/5" aria-label="Next month"><ChevronRight className="h-5 w-5" /></button>
        </div>
        {error ? <ErrorState message={error} onRetry={reload} /> : (
          <div className={clsx("grid grid-cols-7 gap-1", loading && "opacity-60")}>
            {WEEKDAYS.map((w) => <div key={w} className="py-1 text-center font-hindi text-xs font-medium text-muted">{w}</div>)}
            {Array.from({ length: offset }, (_, i) => <div key={`b${i}`} />)}
            {Array.from({ length: days }, (_, i) => {
              const d = i + 1;
              const iso = ymd(ym.y, ym.m, d);
              const evs = byDay.get(d) ?? [];
              const cs = celebs.get(d) ?? [];
              return (
                <button
                  key={d}
                  onClick={() => setSelected(iso)}
                  aria-label={`${formatDate(iso)}: ${evs.length} events`}
                  aria-pressed={selected === iso}
                  className={clsx(
                    "flex min-h-[52px] flex-col items-center rounded-xl p-1 text-sm transition-colors sm:min-h-[64px]",
                    selected === iso ? "bg-forest text-white" : iso === today ? "bg-gold-100 text-forest" : "hover:bg-cream-200",
                    iso < today && selected !== iso && "text-muted",
                  )}
                >
                  <span className="font-semibold">{d}</span>
                  <span className="mt-0.5 flex flex-wrap justify-center gap-0.5">
                    {evs.slice(0, 3).map((e) => (
                      <span key={e.id} className={clsx("h-1.5 w-1.5 rounded-full", e.status === "cancelled" ? "bg-red-400" : selected === iso ? "bg-gold" : "bg-leaf")} />
                    ))}
                    {cs.length > 0 && <span className="text-[10px] leading-none">{cs.some((c) => c.kind === "birthday") ? "🎂" : "💐"}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        <p className="mt-3 flex flex-wrap gap-3 text-xs text-muted">
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-leaf" /> कार्यक्रम · Event</span>
          {isMember && <span>🎂 जन्मदिन · 💐 सालगिरह</span>}
        </p>
      </Card>
      <div>
        <h3 className="mb-3 font-hindi text-lg font-semibold text-forest">{selDay ? formatDate(selected) : "दिन चुनें · Pick a day"}</h3>
        {selDay && !dayEvents.length && !dayCelebs.length && (
          <p className="rounded-2xl bg-white p-4 text-sm text-muted">इस दिन कोई कार्यक्रम नहीं · Nothing scheduled on this day.</p>
        )}
        <div className="space-y-3">
          {dayEvents.map((e) => <EventCard key={e.id} e={e} past={e.event_date < today} />)}
          {dayCelebs.map((c) => (
            <Card key={`${c.kind}-${c.item.id}`} className="flex items-center gap-3 p-3">
              <span className="text-2xl">{c.kind === "birthday" ? "🎂" : "💐"}</span>
              <span className="text-sm">
                <span className="block font-semibold text-forest">{c.item.full_name}</span>
                <span className="text-muted">{c.kind === "birthday" ? "जन्मदिन · Birthday" : "सालगिरह · Anniversary"}{c.years ? ` · ${c.years}` : ""}</span>
              </span>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
