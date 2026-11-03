"use client";
import { Bell, CakeSlice, CalendarDays, Camera, ChevronRight, Images, Music2, Pause, Play, Quote, Sparkles, Users } from "lucide-react";
import Link from "next/link";
import { usePlayer } from "@/components/AudioPlayer";
import TodayCelebrations from "@/components/celebrations/TodayCelebrations";
import UpcomingEvents, { NextEventCard } from "@/components/events/UpcomingEvents";
import FinanceSummary from "@/components/finance/FinanceSummary";
import LatestPhotos from "@/components/gallery/LatestPhotos";
import { Badge, Card, LinkButton, SectionTitle, Skeleton } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { formatDateTime, todayIST } from "@/lib/dates";
import { useLoad } from "@/lib/hooks";
import { publicUrl } from "@/lib/storage";
import { supabase } from "@/lib/supabase";
import type { Announcement } from "@/lib/types";

interface Stats { members: number; photos: number; events: number; celebrations: number }

export default function HomePage() {
  const { site, loading: authLoading } = useAuth();
  const player = usePlayer();
  const hero = publicUrl(site.hero_path);
  const groupPhoto = publicUrl(site.group_photo_path);

  const stats = useLoad(async () => {
    const { data, error } = await supabase.rpc("site_stats");
    if (error) throw error;
    return data as Stats;
  });

  const thought = useLoad(async () => {
    const { data, error } = await supabase.from("thoughts").select("id,text,author").eq("active", true).order("created_at");
    if (error) throw error;
    if (!data?.length) return null;
    // Same thought for everyone all day, rotating daily (IST).
    const t = todayIST();
    const dayOfYear = Math.floor((Date.UTC(t.y, t.m - 1, t.d) - Date.UTC(t.y, 0, 0)) / 86400000);
    return data[dayOfYear % data.length];
  });

  const news = useLoad(async () => {
    const { data, error } = await supabase
      .from("announcements")
      .select("*")
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .order("pinned", { ascending: false })
      .order("published_at", { ascending: false })
      .limit(3);
    if (error) throw error;
    return (data ?? []) as Announcement[];
  }, [authLoading]);

  return (
    <div className="-mt-5 space-y-12">
      {/* ------------------------------------------------------------ hero */}
      <section className="relative -mx-4 overflow-hidden sm:mx-0 sm:mt-4 sm:rounded-[2rem]">
        <div className="absolute inset-0 bg-sunrise" aria-hidden />
        {hero && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={hero} alt="" className="absolute inset-0 h-full w-full object-cover" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-forest-900/90 via-forest-900/45 to-forest-900/10" aria-hidden />
        <div className="relative flex min-h-[78vh] flex-col justify-end px-5 pb-8 pt-24 sm:min-h-[560px] sm:px-10 sm:pb-12">
          <Badge tone="gold" className="mb-4 w-fit">🌅 {site.family_hi}</Badge>
          <h1 className="font-display text-[2rem] leading-[1.25] text-white text-balance sm:text-5xl sm:leading-[1.2]">
            स्वागत है आपका,
            <br />
            <span className="text-gold">पाहिल वाटिका योगा ग्रुप</span> में।
          </h1>
          <p className="mt-4 max-w-xl font-hindi text-lg text-cream/90 sm:text-xl">
            जहाँ योग से स्वास्थ्य मिलता है और साथ से जीवन में खुशियाँ।
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              onClick={player.toggle}
              disabled={!player.src}
              className="inline-flex h-12 items-center gap-2 rounded-full bg-gold px-5 font-semibold text-forest-900 shadow-lift transition hover:bg-gold-600 disabled:opacity-60"
              title={player.src ? undefined : "The theme song has not been uploaded yet"}
            >
              {player.playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
              <span className="font-hindi">{player.playing ? "रोकें" : "परिवार गीत सुनें"}</span>
              <span className="hidden text-sm font-normal sm:inline">· Theme Song</span>
            </button>
            <Link href="/gallery/" className="inline-flex h-12 items-center gap-2 rounded-full bg-white/15 px-5 font-medium text-white ring-1 ring-white/40 backdrop-blur transition hover:bg-white/25">
              <Images className="h-5 w-5" /> <span className="font-hindi">यादें देखें</span>
              <span className="hidden text-sm sm:inline">· Explore Memories</span>
            </Link>
          </div>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <NextEventCard />
            {news.data?.[0] && (
              <Link href="/announcements/" className="flex items-start gap-3 rounded-2xl bg-white/95 p-3.5 shadow-lift backdrop-blur">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gold-100 text-gold-700"><Bell className="h-5 w-5" /></span>
                <span className="min-w-0">
                  <span className="block text-xs font-medium uppercase tracking-wide text-muted">नई सूचना · Latest</span>
                  <span className="block truncate font-hindi font-semibold text-forest">{news.data[0].title}</span>
                  <span className="line-clamp-1 text-sm text-muted">{news.data[0].body}</span>
                </span>
              </Link>
            )}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ intro */}
      <section className="grid items-center gap-6 md:grid-cols-2">
        <div>
          <p className="mb-2 text-sm font-semibold uppercase tracking-[0.18em] text-leaf">{site.name_en}</p>
          <h2 className="font-display text-3xl leading-snug text-forest">{site.tagline}</h2>
          <p className="mt-1 font-hindi text-lg text-leaf-700">{site.subtagline}</p>
          {site.intro ? (
            <p className="mt-4 whitespace-pre-line font-hindi text-[17px] leading-relaxed text-forest-900/85">{site.intro}</p>
          ) : (
            <p className="mt-4 font-hindi text-[17px] leading-relaxed text-forest-900/85">
              हर सुबह खजुराहो की पाहिल वाटिका में हम योग, प्राणायाम और अपनेपन के साथ दिन की शुरुआत करते हैं।
            </p>
          )}
          <blockquote className="mt-5 border-l-4 border-gold pl-4 font-hindi text-lg italic text-forest">“{site.message}”</blockquote>
          {site.session_time && <p className="mt-4 text-sm text-muted">🧘 {site.session_time}</p>}
        </div>
        <div className="relative">
          <div className="absolute -inset-3 -rotate-2 rounded-[2rem] bg-gold/30" aria-hidden />
          {groupPhoto ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={groupPhoto} alt="पाहिल वाटिका योग परिवार" className="relative aspect-[4/3] w-full rounded-[1.75rem] object-cover shadow-lift" />
          ) : (
            <div className="relative flex aspect-[4/3] w-full flex-col items-center justify-center rounded-[1.75rem] bg-sunrise p-6 text-center shadow-lift">
              <Camera className="h-10 w-10 text-gold" />
              <p className="mt-2 font-hindi text-lg text-white">परिवार की सामूहिक तस्वीर</p>
              <p className="text-sm text-cream/75">Group photo — an admin can add it in Website settings.</p>
            </div>
          )}
        </div>
      </section>

      {/* ------------------------------------------------------------ stats */}
      <section aria-label="Community statistics">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {([
            ["members", "सदस्य", "Members", Users],
            ["photos", "तस्वीरें", "Photographs", Images],
            ["events", "कार्यक्रम", "Events", CalendarDays],
            ["celebrations", "उत्सव", "Celebrations", Sparkles],
          ] as const).map(([k, hi, en, Icon]) => (
            <Card key={k} className="p-4 text-center">
              <Icon className="mx-auto h-6 w-6 text-leaf" />
              {stats.loading ? (
                <Skeleton className="mx-auto mt-2 h-8 w-16" />
              ) : (
                <p className="mt-1 text-3xl font-bold text-forest">{stats.data ? stats.data[k] : "—"}</p>
              )}
              <p className="font-hindi text-sm font-medium text-forest">{hi}</p>
              <p className="text-xs text-muted">{en}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------ thought */}
      {thought.data && (
        <section>
          <Card className="relative overflow-hidden bg-forest p-6 text-center text-white sm:p-8">
            <Quote className="absolute left-4 top-4 h-10 w-10 text-gold/30" aria-hidden />
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">आज का सुविचार · Thought of the day</p>
            <p className="mx-auto mt-3 max-w-2xl font-display text-2xl leading-relaxed sm:text-3xl">{thought.data.text}</p>
            {thought.data.author && <p className="mt-2 font-hindi text-cream/70">— {thought.data.author}</p>}
          </Card>
        </section>
      )}

      {/* ------------------------------------------------------------ celebrations */}
      <section>
        <SectionTitle hi="आज के उत्सव" en="Today's birthdays & anniversaries" action={<MoreLink href="/celebrations/" />} />
        <TodayCelebrations />
      </section>

      {/* ------------------------------------------------------------ events */}
      <section>
        <SectionTitle hi="आगामी कार्यक्रम" en="Upcoming events" action={<MoreLink href="/events/" />} />
        <UpcomingEvents limit={3} />
      </section>

      {/* ------------------------------------------------------------ photos */}
      <section>
        <SectionTitle hi="नई यादें" en="Latest photographs" action={<MoreLink href="/gallery/" />} />
        <LatestPhotos limit={8} />
      </section>

      {/* ------------------------------------------------------------ announcements */}
      <section>
        <SectionTitle hi="सूचनाएँ" en="Recent announcements" action={<MoreLink href="/announcements/" />} />
        {news.loading ? (
          <div className="grid gap-3 md:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28" />)}</div>
        ) : !news.data?.length ? (
          <Card className="p-5 text-center text-sm text-muted">अभी कोई सूचना नहीं है · No announcements right now.</Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-3">
            {news.data.map((a) => (
              <Link key={a.id} href={`/announcements/?id=${a.id}`} className="block">
                <Card className="h-full p-4 transition hover:shadow-lift">
                  <div className="mb-1.5 flex flex-wrap gap-1.5">
                    {a.pinned && <Badge tone="gold">📌 Pinned</Badge>}
                    {a.priority !== "normal" && <Badge tone="red">{a.priority === "urgent" ? "अति आवश्यक" : "महत्वपूर्ण"}</Badge>}
                  </div>
                  <p className="font-hindi font-semibold text-forest">{a.title}</p>
                  <p className="mt-1 line-clamp-3 whitespace-pre-line text-sm text-forest-900/80">{a.body}</p>
                  <p className="mt-2 text-xs text-muted">{formatDateTime(a.published_at)}</p>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------ finance */}
      <section>
        <FinanceSummary />
      </section>

      {/* ------------------------------------------------------------ song */}
      <section>
        <Card className="overflow-hidden">
          <div className="flex flex-col items-center gap-5 bg-gradient-to-br from-forest to-leaf-700 p-6 text-white sm:flex-row sm:p-8">
            {player.artwork ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={player.artwork} alt="" className="h-28 w-28 rounded-2xl object-cover shadow-lift" />
            ) : (
              <span className="flex h-28 w-28 items-center justify-center rounded-2xl bg-gold text-forest shadow-lift"><Music2 className="h-12 w-12" /></span>
            )}
            <div className="flex-1 text-center sm:text-left">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">परिवार गीत · Community theme song</p>
              <p className="mt-1 font-display text-2xl">{player.song?.title ?? "Pahil Vatika Yoga Parivaar"}</p>
              {player.song?.description && <p className="mt-1 font-hindi text-cream/80">{player.song.description}</p>}
              {!player.songLoading && !player.src && <p className="mt-1 text-sm text-cream/70">गीत जल्द ही अपलोड होगा · The song will be uploaded soon.</p>}
            </div>
            <div className="flex gap-2">
              <button onClick={player.toggle} disabled={!player.src} className="flex h-14 w-14 items-center justify-center rounded-full bg-gold text-forest shadow-lift disabled:opacity-50" aria-label={player.playing ? "Pause" : "Play theme song"}>
                {player.playing ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6 translate-x-0.5" />}
              </button>
              <LinkButton href="/song/" variant="secondary" className="h-14 rounded-full">बोल · Lyrics</LinkButton>
            </div>
          </div>
        </Card>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["/members/", "परिवार के सदस्य", "Members", Users],
          ["/celebrations/", "जन्मदिन कैलेंडर", "Birthdays", CakeSlice],
          ["/events/", "कैलेंडर", "Calendar", CalendarDays],
          ["/announcements/", "सूचना पट", "Notice board", Bell],
        ].map(([href, hi, en, Icon]) => {
          const I = Icon as typeof Users;
          return (
            <Link key={href as string} href={href as string} className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-card transition hover:shadow-lift">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-leaf-50 text-leaf-700"><I className="h-5 w-5" /></span>
              <span><span className="block font-hindi text-sm font-semibold text-forest">{hi as string}</span><span className="text-xs text-muted">{en as string}</span></span>
            </Link>
          );
        })}
      </section>
    </div>
  );
}

function MoreLink({ href }: { href: string }) {
  return (
    <Link href={href} className="inline-flex shrink-0 items-center gap-0.5 text-sm font-medium text-leaf-700 hover:text-forest">
      सभी देखें <ChevronRight className="h-4 w-4" />
    </Link>
  );
}
