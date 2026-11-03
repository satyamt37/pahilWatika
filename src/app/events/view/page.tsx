"use client";
import {
  ArrowLeft, CalendarDays, CalendarPlus, CheckCircle2, Clock, HelpCircle, Images, Info, MapPin, Pencil, Share2, User, Users, XCircle,
} from "lucide-react";
import Link from "next/link";
import { Suspense, useState } from "react";
import { CategoryBadge, Countdown, STATUS_LABEL, downloadText, eventIcs } from "@/components/events/shared";
import { useToast } from "@/components/toast";
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, Input, LinkButton, Loading } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { formatDate, formatTime, todayISO } from "@/lib/dates";
import { clsx, siteUrl, whatsappUrl } from "@/lib/format";
import { must, useLoad, useQueryParam } from "@/lib/hooks";
import { publicUrl, signedUrls } from "@/lib/storage";
import { supabase } from "@/lib/supabase";
import type { EventRow, Photo } from "@/lib/types";

interface Participant {
  event_id: string;
  user_id: string;
  status: "going" | "maybe" | "not_going";
  guests: number;
  note: string | null;
  name: string | null;
  photo_path: string | null;
}

export default function EventViewPage() {
  return (
    <Suspense fallback={<Loading />}>
      <EventViewFromQuery />
    </Suspense>
  );
}

function EventViewFromQuery() {
  const id = useQueryParam("id");
  return <EventView key={id ?? ""} id={id ?? ""} />;
}

function EventView({ id }: { id: string }) {
  const auth = useAuth();
  const toast = useToast();
  const { data, error, loading, reload } = useLoad(async () => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const ev = must(await supabase.from("events").select("*").eq("id", id).maybeSingle()) as EventRow | null;
    if (!ev) return null;
    const [parts, photos, album] = await Promise.all([
      auth.isMember ? supabase.from("event_participants").select("*").eq("event_id", id).order("updated_at") : Promise.resolve({ data: [], error: null }),
      supabase.from("photos").select("*").eq("event_id", id).is("deleted_at", null).order("created_at", { ascending: false }).limit(24),
      ev.album_id ? supabase.from("albums").select("id,name").eq("id", ev.album_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    ]);
    const pics = (must(photos) ?? []) as Photo[];
    const people = (must(parts) ?? []) as Participant[];
    const [thumbs, avatars] = await Promise.all([
      signedUrls("gallery", pics.map((p) => p.thumb_path)),
      signedUrls("gallery", people.map((p) => p.photo_path)),
    ]);
    return { ev, people, pics, thumbs, avatars, album: (album.data as { id: string; name: string } | null) ?? null };
  }, [id, auth.isMember]);

  const [saving, setSaving] = useState(false);
  const [guests, setGuests] = useState<number | null>(null);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) {
    return (
      <EmptyState
        icon={<CalendarDays className="h-7 w-7" />}
        title="कार्यक्रम नहीं मिला"
        text="This event does not exist or is visible to members only."
        action={<LinkButton href="/events/" variant="secondary">सभी कार्यक्रम · All events</LinkButton>}
      />
    );
  }

  const { ev, people, pics, thumbs, avatars, album } = data;
  const past = ev.event_date < todayISO();
  const cover = publicUrl(ev.cover_path);
  const mine = people.find((p) => p.user_id === auth.user?.id);
  const going = people.filter((p) => p.status === "going");
  const seatsUsed = going.reduce((s, p) => s + 1 + p.guests, 0);
  const g = guests ?? mine?.guests ?? 0;
  const rsvpOpen = ev.rsvp_enabled && !past && ev.status !== "cancelled";
  const url = siteUrl(`/events/view/?id=${ev.id}`);

  const rsvp = async (status: Participant["status"]) => {
    if (!auth.user) return;
    setSaving(true);
    const { error: e } = await supabase
      .from("event_rsvps")
      .upsert({ event_id: ev.id, user_id: auth.user.id, status, guests: status === "going" ? g : 0 }, { onConflict: "event_id,user_id" });
    setSaving(false);
    if (e) return toast.error(e);
    toast.success(status === "going" ? "आपकी उपस्थिति दर्ज हुई · See you there!" : "आपका जवाब सहेजा गया · Response saved");
    reload();
  };

  const share = () => {
    const text = `🧘 ${ev.title}\n📅 ${formatDate(ev.event_date)}${ev.start_time ? `, ${formatTime(ev.start_time)}` : ""}${ev.venue ? `\n📍 ${ev.venue}` : ""}\n\n— पाहिल वाटिका योगा ग्रुप, खजुराहो\n${url}`;
    window.open(whatsappUrl(text), "_blank", "noopener");
  };

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/events/" className="mb-3 inline-flex h-10 items-center gap-1.5 text-sm font-medium text-leaf-700 hover:underline">
        <ArrowLeft className="h-4 w-4" /> सभी कार्यक्रम · All events
      </Link>
      <Card className="overflow-hidden">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover} alt="" className="aspect-[16/9] w-full object-cover" />
        ) : (
          <div className="flex aspect-[16/7] w-full items-center justify-center bg-sunrise text-6xl">🧘</div>
        )}
        <div className="p-4 sm:p-6">
          <div className="mb-2 flex flex-wrap gap-1.5">
            <CategoryBadge category={ev.category} />
            {ev.status !== "scheduled" && <Badge tone="red">{STATUS_LABEL[ev.status]}</Badge>}
            {past && <Badge tone="grey">पिछला कार्यक्रम · Past event</Badge>}
          </div>
          <h1 className="font-hindi text-2xl font-bold text-forest sm:text-3xl">{ev.title}</h1>
          <div className="mt-3 grid gap-2 text-[15px] text-forest-900 sm:grid-cols-2">
            <p className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-leaf" />{formatDate(ev.event_date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
            {ev.start_time && <p className="flex items-center gap-2"><Clock className="h-4 w-4 text-leaf" />{formatTime(ev.start_time)}{ev.end_time ? ` – ${formatTime(ev.end_time)}` : ""}</p>}
            {ev.venue && (
              <a className="flex items-center gap-2 hover:underline" target="_blank" rel="noopener noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ev.venue + ", Khajuraho")}`}>
                <MapPin className="h-4 w-4 text-leaf" />{ev.venue}
              </a>
            )}
            {ev.organizer && <p className="flex items-center gap-2"><User className="h-4 w-4 text-leaf" />{ev.organizer}</p>}
          </div>

          {!past && ev.status === "scheduled" && (
            <div className="mt-5"><Countdown date={ev.event_date} time={ev.start_time} /></div>
          )}

          <div className="mt-5 flex flex-wrap gap-2">
            <Button variant="secondary" icon={<Share2 className="h-4 w-4" />} onClick={share}>WhatsApp पर भेजें</Button>
            <Button variant="secondary" icon={<CalendarPlus className="h-4 w-4" />} onClick={() => downloadText(`${ev.title.replace(/[^\wऀ-ॿ]+/g, "-")}.ics`, eventIcs(ev, url), "text/calendar")}>
              कैलेंडर में जोड़ें
            </Button>
            {auth.isAdmin && <LinkButton href="/admin/?tab=events" variant="ghost" icon={<Pencil className="h-4 w-4" />}>Edit</LinkButton>}
          </div>

          {ev.description && <p className="mt-6 whitespace-pre-line text-[15px] leading-relaxed text-forest-900">{ev.description}</p>}
          {ev.instructions && (
            <div className="mt-5 rounded-2xl bg-gold-100 p-4">
              <p className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-gold-700"><Info className="h-4 w-4" /> निर्देश · Instructions</p>
              <p className="whitespace-pre-line text-[15px] text-forest-900">{ev.instructions}</p>
            </div>
          )}
          {ev.registration_info && (
            <div className="mt-3 rounded-2xl bg-leaf-50 p-4">
              <p className="mb-1 text-sm font-semibold text-leaf-700">पंजीकरण · Registration</p>
              <p className="whitespace-pre-line text-[15px] text-forest-900">{ev.registration_info}</p>
            </div>
          )}
        </div>
      </Card>

      {/* RSVP */}
      {ev.rsvp_enabled && (
        <Card className="mt-4 p-4 sm:p-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-hindi text-lg font-semibold text-forest">क्या आप आएँगे? · RSVP</h2>
            <span className="text-sm text-muted">
              <Users className="mr-1 inline h-4 w-4" />
              {seatsUsed} आ रहे हैं{ev.max_capacity ? ` / ${ev.max_capacity} seats` : ""}
            </span>
          </div>
          {ev.max_capacity && (
            <div className="mb-4 h-2 overflow-hidden rounded-full bg-cream-200">
              <div className="h-full bg-leaf" style={{ width: `${Math.min(100, (seatsUsed / ev.max_capacity) * 100)}%` }} />
            </div>
          )}
          {!auth.user ? (
            <LinkButton href={`/login/?next=${encodeURIComponent(`/events/view/?id=${ev.id}`)}`}>RSVP के लिए लॉगिन करें · Sign in to RSVP</LinkButton>
          ) : !auth.isMember ? (
            <p className="text-sm text-muted">Your account is awaiting approval.</p>
          ) : !rsvpOpen ? (
            <p className="text-sm text-muted">{past ? "यह कार्यक्रम हो चुका है · RSVP closed for past events." : "RSVP बंद है · RSVP is closed."}{mine ? ` Your response: ${mine.status}.` : ""}</p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <label htmlFor="guests" className="text-sm text-forest">साथ में मेहमान · Guests</label>
                <Input id="guests" type="number" min={0} max={10} value={g} onChange={(e) => setGuests(Math.max(0, Math.min(10, Number(e.target.value) || 0)))} className="w-24" />
              </div>
              <div className="grid grid-cols-3 gap-2">
                {([
                  ["going", "हाँ, आऊँगा", CheckCircle2],
                  ["maybe", "शायद", HelpCircle],
                  ["not_going", "नहीं", XCircle],
                ] as const).map(([s, label, Icon]) => (
                  <Button key={s} variant={mine?.status === s ? "primary" : "secondary"} disabled={saving} onClick={() => rsvp(s)} icon={<Icon className="h-4 w-4" />}>
                    {label}
                  </Button>
                ))}
              </div>
              {mine && <p className="text-xs text-muted">आपका जवाब · Your response: <b>{mine.status.replace("_", " ")}</b>{mine.guests ? ` + ${mine.guests} guests` : ""}</p>}
            </div>
          )}

          {auth.isMember && people.length > 0 && (
            <div className="mt-5">
              <h3 className="mb-2 text-sm font-semibold text-forest">प्रतिभागी · Participants</h3>
              <ul className="divide-y divide-forest/5">
                {people.map((p) => (
                  <li key={p.user_id} className="flex items-center gap-3 py-2">
                    <Avatar name={p.name ?? "?"} src={p.photo_path ? avatars[p.photo_path] : null} size={36} />
                    <span className="min-w-0 flex-1 truncate text-[15px]">{p.name ?? "Member"}{p.guests ? <span className="text-muted"> +{p.guests}</span> : null}</span>
                    <Badge tone={p.status === "going" ? "green" : p.status === "maybe" ? "gold" : "grey"}>
                      {p.status === "going" ? "आ रहे" : p.status === "maybe" ? "शायद" : "नहीं"}
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      {/* Photos */}
      {(pics.length > 0 || album) && (
        <Card className="mt-4 p-4 sm:p-6">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="font-hindi text-lg font-semibold text-forest">कार्यक्रम की तस्वीरें · Photos</h2>
            {album && <Link href={`/gallery/?album=${album.id}`} className="text-sm font-medium text-leaf-700 hover:underline"><Images className="mr-1 inline h-4 w-4" />{album.name}</Link>}
          </div>
          {pics.length ? (
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
              {pics.map((p) => (
                <Link key={p.id} href={`/gallery/?photo=${p.id}`} className="relative block aspect-square overflow-hidden rounded-xl bg-cream-200">
                  {p.thumb_path && thumbs[p.thumb_path] && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumbs[p.thumb_path]} alt={p.caption ?? ""} loading="lazy" className={clsx("h-full w-full object-cover transition-transform hover:scale-105")} />
                  )}
                  {p.media_type !== "image" && <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1.5 text-xs text-white">▶</span>}
                </Link>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">अभी कोई तस्वीर नहीं · No photos yet.</p>
          )}
        </Card>
      )}
    </div>
  );
}
