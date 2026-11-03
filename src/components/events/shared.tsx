"use client";
import { CalendarDays, Clock, MapPin } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge, Card } from "@/components/ui";
import { daysFromToday, formatDate, formatTime, msUntilIST, todayISO } from "@/lib/dates";
import { clsx } from "@/lib/format";
import { publicUrl } from "@/lib/storage";
import { EVENT_CATEGORIES, type EventRow } from "@/lib/types";

export const STATUS_LABEL: Record<EventRow["status"], string> = {
  scheduled: "निर्धारित · Scheduled",
  cancelled: "रद्द · Cancelled",
  postponed: "स्थगित · Postponed",
};

/** Upcoming = IST date today or later; past = strictly before today. Never mixed. */
export function isUpcoming(e: Pick<EventRow, "event_date">, today = todayISO()): boolean {
  return e.event_date >= today;
}

function parts(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}

/** Live countdown to an event's IST start. */
export function Countdown({ date, time, compact, dark }: { date: string; time: string | null; compact?: boolean; dark?: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const ms = msUntilIST(date, time, new Date(now));
  if (ms <= 0) {
    const today = daysFromToday(date) === 0;
    return <span className={clsx("font-medium", dark ? "text-gold" : "text-leaf-700")}>{today ? "आज है! · Happening today" : "शुरू हो चुका · Started"}</span>;
  }
  const p = parts(ms);
  if (compact) {
    return (
      <span className={clsx("font-medium tabular-nums", dark ? "text-gold" : "text-leaf-700")}>
        {p.d > 0 ? `${p.d} दिन ${p.h} घंटे` : `${p.h}h ${String(p.m).padStart(2, "0")}m ${String(p.s).padStart(2, "0")}s`}
      </span>
    );
  }
  const cells: [number, string][] = [[p.d, "दिन · Days"], [p.h, "घंटे · Hrs"], [p.m, "मिनट · Min"], [p.s, "सेकंड · Sec"]];
  return (
    <div className="grid grid-cols-4 gap-2" role="timer" aria-label="Countdown">
      {cells.map(([v, l]) => (
        <div key={l} className={clsx("rounded-xl px-1 py-2 text-center", dark ? "bg-white/10 text-white" : "bg-leaf-50 text-forest")}>
          <div className="text-2xl font-bold tabular-nums">{String(v).padStart(2, "0")}</div>
          <div className={clsx("text-[10px] leading-tight", dark ? "text-white/70" : "text-muted")}>{l}</div>
        </div>
      ))}
    </div>
  );
}

export function CategoryBadge({ category }: { category: EventRow["category"] }) {
  const c = EVENT_CATEGORIES[category] ?? EVENT_CATEGORIES.other;
  return <Badge tone="gold">{c.emoji} <span className="font-hindi">{c.hi}</span></Badge>;
}

export function EventCard({ e, past }: { e: EventRow; past?: boolean }) {
  const cover = publicUrl(e.cover_path);
  const cat = EVENT_CATEGORIES[e.category] ?? EVENT_CATEGORIES.other;
  const d = e.event_date.slice(8, 10);
  return (
    <Link href={`/events/view/?id=${e.id}`} className="group block focus-visible:outline-none">
      <Card className={clsx("flex h-full overflow-hidden transition-shadow group-hover:shadow-lift group-focus-visible:ring-2 group-focus-visible:ring-gold", past && "opacity-90")}>
        <div className="relative w-28 shrink-0 sm:w-36">
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cover} alt="" loading="lazy" className={clsx("h-full w-full object-cover", past && "grayscale-[40%]")} />
          ) : (
            <div className="flex h-full min-h-[112px] w-full items-center justify-center bg-sunrise text-4xl">{cat.emoji}</div>
          )}
          <div className="absolute left-2 top-2 rounded-xl bg-white/95 px-2 py-1 text-center shadow">
            <div className="text-lg font-bold leading-none text-forest">{Number(d)}</div>
            <div className="text-[10px] font-semibold uppercase text-leaf-700">{formatDate(e.event_date, { month: "short" })}</div>
          </div>
        </div>
        <div className="min-w-0 flex-1 p-3.5">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <CategoryBadge category={e.category} />
            {e.status !== "scheduled" && <Badge tone="red">{STATUS_LABEL[e.status]}</Badge>}
          </div>
          <h3 className="line-clamp-2 font-hindi text-[17px] font-semibold leading-snug text-forest">{e.title}</h3>
          <div className="mt-1.5 space-y-0.5 text-sm text-muted">
            <p className="flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5 shrink-0" />{formatDate(e.event_date)}</p>
            {e.start_time && (
              <p className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5 shrink-0" />{formatTime(e.start_time)}{e.end_time ? ` – ${formatTime(e.end_time)}` : ""}</p>
            )}
            {e.venue && <p className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{e.venue}</span></p>}
          </div>
          {!past && e.status === "scheduled" && (
            <p className="mt-1.5 text-sm"><Countdown date={e.event_date} time={e.start_time} compact /></p>
          )}
        </div>
      </Card>
    </Link>
  );
}

function icsEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, (c) => `\\${c}`);
}

/** Build an .ics calendar file for an event (times in Asia/Kolkata). */
export function eventIcs(e: EventRow, url: string): string {
  const date = e.event_date.replace(/-/g, "");
  const t = (x: string) => x.slice(0, 5).replace(":", "") + "00";
  const nextDay = (() => {
    const [y, m, d] = e.event_date.split("-").map(Number);
    const n = new Date(Date.UTC(y, m - 1, d + 1));
    return n.toISOString().slice(0, 10).replace(/-/g, "");
  })();
  const start = e.start_time ? `DTSTART;TZID=Asia/Kolkata:${date}T${t(e.start_time)}` : `DTSTART;VALUE=DATE:${date}`;
  const end = e.start_time
    ? `DTEND;TZID=Asia/Kolkata:${date}T${t(e.end_time ?? e.start_time)}`
    : `DTEND;VALUE=DATE:${nextDay}`;
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Pahil Vatika//Events//HI", "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${e.id}@pahil-vatika`, `DTSTAMP:${stamp}`, start, end,
    `SUMMARY:${icsEscape(e.title)}`,
    e.venue ? `LOCATION:${icsEscape(e.venue)}` : "",
    `DESCRIPTION:${icsEscape([e.description, url].filter(Boolean).join("\n\n"))}`,
    `URL:${url}`,
    "END:VEVENT", "END:VCALENDAR",
  ].filter(Boolean).join("\r\n");
}

export function downloadText(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
