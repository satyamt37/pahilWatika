"use client";
import { CalendarDays, MapPin } from "lucide-react";
import Link from "next/link";
import { EmptyState, ErrorState, LinkButton, Skeleton } from "@/components/ui";
import { formatDate, formatTime, todayISO } from "@/lib/dates";
import { must, useLoad } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import { EVENT_CATEGORIES, type EventRow } from "@/lib/types";
import { Countdown, EventCard } from "./shared";

async function loadUpcoming(limit: number): Promise<EventRow[]> {
  return must(
    await supabase
      .from("events")
      .select("*")
      .gte("event_date", todayISO())
      .neq("status", "cancelled")
      .order("event_date")
      .order("start_time", { nullsFirst: true })
      .limit(limit),
  ) as EventRow[];
}

/** Homepage list of the next few events. */
export default function UpcomingEvents({ limit = 3 }: { limit?: number }) {
  const { data, error, loading, reload } = useLoad(() => loadUpcoming(limit), [limit]);
  if (loading) {
    return (
      <div className="grid gap-3 md:grid-cols-3">
        {Array.from({ length: Math.min(limit, 3) }, (_, i) => <Skeleton key={i} className="h-32" />)}
      </div>
    );
  }
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data?.length) {
    return (
      <EmptyState
        icon={<CalendarDays className="h-7 w-7" />}
        title="अभी कोई आगामी कार्यक्रम नहीं"
        text="No upcoming events right now. Past events are in the archive."
        action={<LinkButton href="/events/?tab=past" variant="secondary" size="sm">पिछले कार्यक्रम · Past events</LinkButton>}
      />
    );
  }
  return (
    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
      {data.map((e) => <EventCard key={e.id} e={e} />)}
    </div>
  );
}

/** Compact hero card for the next upcoming event; renders nothing when there is none. */
export function NextEventCard() {
  const { data } = useLoad(() => loadUpcoming(1), []);
  const e = data?.[0];
  if (!e) return null;
  const cat = EVENT_CATEGORIES[e.category] ?? EVENT_CATEGORIES.other;
  return (
    <Link
      href={`/events/view/?id=${e.id}`}
      className="block rounded-2xl border border-white/15 bg-white/10 p-4 text-white backdrop-blur-md transition-colors hover:bg-white/15"
    >
      <p className="text-xs font-semibold uppercase tracking-wider text-gold">अगला कार्यक्रम · Next event</p>
      <p className="mt-1 font-hindi text-lg font-semibold leading-snug">{cat.emoji} {e.title}</p>
      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-white/80">
        <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />{formatDate(e.event_date)}{e.start_time ? `, ${formatTime(e.start_time)}` : ""}</span>
        {e.venue && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{e.venue}</span>}
      </p>
      <p className="mt-1.5 text-sm"><Countdown date={e.event_date} time={e.start_time} compact dark /></p>
    </Link>
  );
}
