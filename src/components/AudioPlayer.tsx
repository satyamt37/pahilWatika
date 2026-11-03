"use client";
// One <audio> element for the whole app: the song page and the floating
// mini-player both drive it, so the theme song can never play twice at once.
import { Music2, Pause, Play, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { publicUrl } from "@/lib/storage";
import { isConfigured, supabase } from "@/lib/supabase";
import type { ThemeSong } from "@/lib/types";

interface PlayerState {
  song: ThemeSong | null;
  songLoading: boolean;
  src: string | null;
  artwork: string | null;
  playing: boolean;
  buffering: boolean;
  current: number;
  duration: number;
  volume: number;
  muted: boolean;
  error: string | null;
  started: boolean; // user has pressed play at least once
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (t: number) => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  replay: () => void;
  stop: () => void;
  reloadSong: () => Promise<void>;
}

const Ctx = createContext<PlayerState | null>(null);

export function AudioProvider({ children }: { children: ReactNode }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [song, setSong] = useState<ThemeSong | null>(null);
  const [songLoading, setSongLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVol] = useState(0.9);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);

  const reloadSong = useCallback(async () => {
    if (!isConfigured) return setSongLoading(false);
    const { data } = await supabase.from("theme_song").select("*").eq("id", 1).maybeSingle();
    setSong((data as ThemeSong) ?? null);
    setSongLoading(false);
  }, []);
  useEffect(() => {
    reloadSong();
  }, [reloadSong]);

  const src = publicUrl(song?.audio_path);
  const artwork = publicUrl(song?.artwork_path);

  // Never autoplay: the element is created lazily on the first user action.
  const ensure = useCallback(() => {
    if (!src) return null;
    if (!audio.current) {
      const a = new Audio();
      a.preload = "metadata";
      a.addEventListener("timeupdate", () => setCurrent(a.currentTime));
      a.addEventListener("durationchange", () => setDuration(Number.isFinite(a.duration) ? a.duration : 0));
      a.addEventListener("loadedmetadata", () => setDuration(Number.isFinite(a.duration) ? a.duration : 0));
      a.addEventListener("play", () => setPlaying(true));
      a.addEventListener("pause", () => setPlaying(false));
      a.addEventListener("ended", () => setPlaying(false));
      a.addEventListener("waiting", () => setBuffering(true));
      a.addEventListener("playing", () => setBuffering(false));
      a.addEventListener("canplay", () => setBuffering(false));
      a.addEventListener("error", () => {
        setBuffering(false);
        setPlaying(false);
        setError("गीत लोड नहीं हो सका · Could not load the song");
      });
      audio.current = a;
    }
    if (audio.current.src !== src) {
      audio.current.src = src;
      setCurrent(0);
    }
    audio.current.volume = volume;
    audio.current.muted = muted;
    return audio.current;
  }, [src, volume, muted]);

  // Admin replaced the file: stop the old one.
  useEffect(() => {
    if (audio.current && src && audio.current.src !== src) {
      audio.current.pause();
      audio.current.src = src;
      setCurrent(0);
    }
  }, [src]);

  const play = useCallback(() => {
    const a = ensure();
    if (!a) return;
    setError(null);
    setStarted(true);
    setBuffering(true);
    a.play().catch(() => {
      setBuffering(false);
      setError("चलाने में समस्या · Playback was blocked, tap play again");
    });
  }, [ensure]);
  const pause = useCallback(() => audio.current?.pause(), []);

  // Pause when the tab is closed/hidden on iOS is handled by the OS; stop on unmount.
  useEffect(() => () => audio.current?.pause(), []);

  const value: PlayerState = {
    song, songLoading, src, artwork, playing, buffering, current, duration, volume, muted, error, started,
    play,
    pause,
    toggle: () => (playing ? pause() : play()),
    seek: (t) => {
      const a = ensure();
      if (a) a.currentTime = Math.max(0, Math.min(t, duration || t));
      setCurrent(t);
    },
    setVolume: (v) => {
      setVol(v);
      if (audio.current) audio.current.volume = v;
      if (v > 0 && muted) {
        setMuted(false);
        if (audio.current) audio.current.muted = false;
      }
    },
    toggleMute: () => {
      setMuted((m) => {
        if (audio.current) audio.current.muted = !m;
        return !m;
      });
    },
    replay: () => {
      const a = ensure();
      if (!a) return;
      a.currentTime = 0;
      play();
    },
    stop: () => {
      audio.current?.pause();
      if (audio.current) audio.current.currentTime = 0;
      setStarted(false);
    },
    reloadSong,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePlayer(): PlayerState {
  const c = useContext(Ctx);
  if (!c) throw new Error("usePlayer outside AudioProvider");
  return c;
}

export function fmtTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

/** Floating mini-player shown above the bottom navigation once the song has been started. */
export function MiniPlayer() {
  const p = usePlayer();
  const path = usePathname();
  if (!p.started || !p.src || path?.startsWith("/song")) return null;
  const pct = p.duration ? (p.current / p.duration) * 100 : 0;
  return (
    <div className="fixed inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-40 mx-auto max-w-md md:bottom-4 md:right-4 md:left-auto md:mx-0 md:w-96">
      <div className="overflow-hidden rounded-2xl bg-forest text-white shadow-lift">
        <div className="flex items-center gap-3 p-2.5">
          <Link href="/song/" className="flex min-w-0 flex-1 items-center gap-3">
            {p.artwork ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.artwork} alt="" className="h-11 w-11 rounded-xl object-cover" />
            ) : (
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gold text-forest"><Music2 className="h-5 w-5" /></span>
            )}
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{p.song?.title}</span>
              <span className="block text-xs text-white/70">{fmtTime(p.current)} / {fmtTime(p.duration)}</span>
            </span>
          </Link>
          <button onClick={p.toggle} className="flex h-11 w-11 items-center justify-center rounded-full bg-gold text-forest" aria-label={p.playing ? "Pause" : "Play"}>
            {p.playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 translate-x-px" />}
          </button>
          <button onClick={p.stop} className="rounded-full p-2 text-white/70 hover:bg-white/10" aria-label="Close player">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="h-1 bg-white/15"><div className="h-full bg-gold transition-[width]" style={{ width: `${pct}%` }} /></div>
      </div>
    </div>
  );
}
