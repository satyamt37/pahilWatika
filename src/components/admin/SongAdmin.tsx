"use client";
import { ImageUp, Music2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { usePlayer } from "@/components/AudioPlayer";
import { useToast } from "@/components/toast";
import { Button, Card, Field, Input, Textarea } from "@/components/ui";
import { bytes } from "@/lib/format";
import { processImage } from "@/lib/image";
import { parseLrc } from "@/lib/lrc";
import { fileExt, uploadSiteFile } from "@/lib/storage";
import { supabase } from "@/lib/supabase";

const AUDIO_TYPES = ["audio/mpeg", "audio/mp3", "audio/mp4", "audio/x-m4a", "audio/aac", "audio/wav"];
const MAX_AUDIO = 50 * 1024 * 1024;

export default function SongAdmin() {
  const toast = useToast();
  const player = usePlayer();
  const s = player.song;
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [lrc, setLrc] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const audioRef = useRef<HTMLInputElement>(null);
  const artRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTitle(s?.title ?? "Pahil Vatika Yoga Parivaar");
    setDescription(s?.description ?? "");
    setLyrics(s?.lyrics ?? "");
    setLrc(s?.lrc ?? "");
  }, [s]);

  async function save(patch: Record<string, unknown>, label: string) {
    setBusy(label);
    try {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from("theme_song").upsert({ id: 1, ...patch, updated_by: u.user?.id, updated_at: new Date().toISOString() });
      if (error) throw error;
      await player.reloadSong();
      toast.success("सहेजा गया · Saved");
      return true;
    } catch (e) {
      toast.error(e);
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function uploadAudio(f: File | undefined) {
    if (!f) return;
    const okType = AUDIO_TYPES.includes(f.type) || /\.(mp3|m4a|aac|wav)$/i.test(f.name);
    if (!okType) return toast.error("Please choose an MP3 (or M4A/AAC/WAV) audio file");
    if (f.size > MAX_AUDIO) return toast.error(`File is ${bytes(f.size)} — the limit is 50 MB`);
    setBusy("audio");
    try {
      const old = s?.audio_path;
      const typed = f.type ? f : new File([f], f.name, { type: "audio/mpeg" });
      const path = await uploadSiteFile("song", typed, fileExt(f.name, "mp3"));
      player.stop();
      if (await save({ audio_path: path }, "audio") && old) await supabase.storage.from("site").remove([old]);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
      if (audioRef.current) audioRef.current.value = "";
    }
  }

  async function uploadArt(f: File | undefined) {
    if (!f) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(f.type)) return toast.error("Please choose a JPG, PNG or WEBP image");
    setBusy("art");
    try {
      const { display } = await processImage(f, { maxSide: 1200 });
      const old = s?.artwork_path;
      const path = await uploadSiteFile("song", display, "jpg");
      if (await save({ artwork_path: path }, "art") && old) await supabase.storage.from("site").remove([old]);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
      if (artRef.current) artRef.current.value = "";
    }
  }

  const lrcLines = parseLrc(lrc).length;

  return (
    <div className="space-y-5">
      <Card className="grid gap-5 p-5 sm:grid-cols-2">
        <div>
          <p className="mb-2 font-semibold text-forest">गीत फ़ाइल · Song file</p>
          <p className="text-sm text-muted">{s?.audio_path ? "✅ Uploaded — playing from cloud storage." : "No song uploaded yet."}</p>
          {player.src && <audio controls preload="none" src={player.src} className="mt-3 w-full" />}
          <input ref={audioRef} type="file" accept="audio/mpeg,audio/mp3,.mp3,audio/mp4,.m4a,audio/aac,audio/wav" className="hidden" onChange={(e) => uploadAudio(e.target.files?.[0])} />
          <Button className="mt-3" onClick={() => audioRef.current?.click()} loading={busy === "audio"} icon={<Upload className="h-4 w-4" />}>
            {s?.audio_path ? "MP3 बदलें · Replace MP3" : "MP3 अपलोड करें · Upload MP3"}
          </Button>
          <p className="mt-1 text-xs text-muted">Max 50 MB. Upload the original recording — the site never substitutes music.</p>
        </div>
        <div>
          <p className="mb-2 font-semibold text-forest">एल्बम कवर · Artwork</p>
          {player.artwork ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={player.artwork} alt="Artwork" className="h-32 w-32 rounded-2xl object-cover" />
          ) : (
            <div className="flex h-32 w-32 items-center justify-center rounded-2xl bg-cream-200"><Music2 className="h-10 w-10 text-muted" /></div>
          )}
          <input ref={artRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => uploadArt(e.target.files?.[0])} />
          <Button className="mt-3" variant="secondary" onClick={() => artRef.current?.click()} loading={busy === "art"} icon={<ImageUp className="h-4 w-4" />}>
            कवर बदलें · Artwork
          </Button>
        </div>
      </Card>

      <Card className="space-y-4 p-5">
        <Field label="शीर्षक · Title" required>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="विवरण · Description">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="गीत के बोल · Lyrics (plain text)">
          <Textarea value={lyrics} onChange={(e) => setLyrics(e.target.value)} className="min-h-[200px] font-hindi" />
        </Field>
        <Field label="Synchronised lyrics (optional, LRC format)" hint={`Lines like "[00:12.50] पहली पंक्ति". ${lrcLines ? `${lrcLines} timed lines detected.` : "When present, lyrics highlight in time with the song."}`}>
          <Textarea value={lrc} onChange={(e) => setLrc(e.target.value)} className="min-h-[160px] font-mono text-sm" />
        </Field>
        <div className="flex justify-end">
          <Button loading={busy === "text"} disabled={title.trim().length < 2}
            onClick={() => save({ title: title.trim(), description: description.trim() || null, lyrics: lyrics.trim() || null, lrc: lrc.trim() || null }, "text")}>
            सहेजें · Save
          </Button>
        </div>
      </Card>
    </div>
  );
}
