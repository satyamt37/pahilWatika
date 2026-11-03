"use client";
import { Loader2, Music2, Pause, Play, RotateCcw, Share2, Volume1, Volume2, VolumeX } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { fmtTime, usePlayer } from "@/components/AudioPlayer";
import { Card, EmptyState, LinkButton, Loading } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { clsx, siteUrl, whatsappUrl } from "@/lib/format";
import { activeLine, parseLrc } from "@/lib/lrc";

export default function SongPage() {
  const p = usePlayer();
  const { isAdmin } = useAuth();
  const lines = useMemo(() => parseLrc(p.song?.lrc), [p.song?.lrc]);
  const activeIdx = activeLine(lines, p.current + 0.2);
  const lyricBox = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activeIdx < 0 || !lyricBox.current) return;
    const el = lyricBox.current.querySelector<HTMLElement>(`[data-i="${activeIdx}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeIdx]);

  if (p.songLoading) return <Loading />;

  const share = async () => {
    const url = siteUrl("/song/");
    const text = `🎵 ${p.song?.title ?? "Pahil Vatika Yoga Parivaar"} — पाहिल वाटिका योग परिवार का गीत`;
    if (navigator.share) await navigator.share({ title: p.song?.title, text, url }).catch(() => undefined);
    else window.open(whatsappUrl(`${text}\n${url}`), "_blank", "noopener");
  };

  const VolIcon = p.muted || p.volume === 0 ? VolumeX : p.volume < 0.5 ? Volume1 : Volume2;

  return (
    <div className="mx-auto max-w-3xl">
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-b from-forest-900 via-forest to-leaf-700 px-5 pb-8 pt-8 text-white sm:px-10">
          <div className="flex flex-col items-center text-center">
            <div className={clsx("relative h-56 w-56 overflow-hidden rounded-3xl shadow-lift sm:h-64 sm:w-64", p.playing && "ring-4 ring-gold/60")}>
              {p.artwork ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.artwork} alt="Album artwork" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-sunrise"><Music2 className="h-20 w-20 text-gold" /></div>
              )}
            </div>
            <p className="mt-6 text-xs font-semibold uppercase tracking-[0.22em] text-gold">परिवार गीत · Theme song</p>
            <h1 className="mt-1 font-display text-3xl">{p.song?.title ?? "Pahil Vatika Yoga Parivaar"}</h1>
            {p.song?.description && <p className="mt-2 max-w-lg whitespace-pre-line font-hindi text-cream/85">{p.song.description}</p>}
          </div>

          {!p.src ? (
            <div className="mt-8 rounded-2xl bg-white/10 p-5 text-center">
              <p className="font-hindi">गीत अभी अपलोड नहीं हुआ है।</p>
              <p className="text-sm text-cream/75">The original song has not been uploaded yet.</p>
              {isAdmin && <LinkButton href="/admin/?tab=song" variant="gold" className="mt-3">Upload the MP3</LinkButton>}
            </div>
          ) : (
            <div className="mx-auto mt-8 max-w-xl">
              <input
                type="range" min={0} max={p.duration || 0} step={0.1} value={Math.min(p.current, p.duration || 0)}
                onChange={(e) => p.seek(+e.target.value)}
                className="range-gold h-2 w-full cursor-pointer" aria-label="Seek"
                disabled={!p.duration}
              />
              <div className="mt-1 flex justify-between text-sm tabular-nums text-cream/80">
                <span>{fmtTime(p.current)}</span>
                <span>{p.duration ? fmtTime(p.duration) : "--:--"}</span>
              </div>
              <div className="mt-4 flex items-center justify-center gap-5">
                <button onClick={p.replay} className="rounded-full p-3 text-cream/90 hover:bg-white/10" aria-label="Replay from start"><RotateCcw className="h-6 w-6" /></button>
                <button onClick={p.toggle} className="flex h-20 w-20 items-center justify-center rounded-full bg-gold text-forest shadow-lift transition hover:scale-105" aria-label={p.playing ? "Pause" : "Play"}>
                  {p.buffering && p.playing ? <Loader2 className="h-8 w-8 animate-spin" /> : p.playing ? <Pause className="h-9 w-9" /> : <Play className="h-9 w-9 translate-x-0.5" />}
                </button>
                <button onClick={share} className="rounded-full p-3 text-cream/90 hover:bg-white/10" aria-label="Share"><Share2 className="h-6 w-6" /></button>
              </div>
              <div className="mx-auto mt-5 flex max-w-xs items-center gap-3">
                <button onClick={p.toggleMute} className="rounded-full p-2 hover:bg-white/10" aria-label={p.muted ? "Unmute" : "Mute"}><VolIcon className="h-5 w-5" /></button>
                <input type="range" min={0} max={1} step={0.05} value={p.muted ? 0 : p.volume} onChange={(e) => p.setVolume(+e.target.value)} className="range-gold w-full" aria-label="Volume" />
              </div>
              {p.error && <p className="mt-3 text-center text-sm text-gold">{p.error}</p>}
            </div>
          )}
        </div>

        <div className="px-5 py-6 sm:px-10">
          <h2 className="mb-3 font-hindi text-lg font-semibold text-forest">गीत के बोल · Lyrics</h2>
          {lines.length > 0 ? (
            <div ref={lyricBox} className="max-h-[50vh] space-y-2 overflow-y-auto rounded-2xl bg-cream-100 p-5 text-center">
              {lines.map((l, i) => (
                <button key={i} data-i={i} onClick={() => p.seek(l.t)}
                  className={clsx("block w-full font-hindi text-lg transition-all", i === activeIdx ? "scale-105 font-semibold text-forest" : "text-forest/45 hover:text-forest/70")}>
                  {l.text || "♪"}
                </button>
              ))}
            </div>
          ) : p.song?.lyrics ? (
            <p className="whitespace-pre-line rounded-2xl bg-cream-100 p-5 text-center font-hindi text-lg leading-loose text-forest">{p.song.lyrics}</p>
          ) : (
            <EmptyState title="बोल जल्द ही" text="Lyrics will be added by the admin." />
          )}
        </div>
      </Card>
    </div>
  );
}
