"use client";
// Greeting card generator: draws a 1080×1350 card on a canvas so it can be
// downloaded as PNG or shared straight to WhatsApp from a phone.
import { Download, Share2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@/components/toast";
import { Button, Field, Input, Modal, Select, Textarea } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { ordinal } from "@/lib/dates";
import { whatsappUrl } from "@/lib/format";
import { useLoad } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";

interface Template {
  id: string;
  kind: "birthday" | "anniversary";
  lang: "hi" | "en";
  title: string;
  body: string;
  is_default: boolean;
}

const FALLBACK: Template[] = [
  {
    id: "fb-b", kind: "birthday", lang: "hi", is_default: true, title: "जन्मदिन की हार्दिक शुभकामनाएँ!",
    body: "आपका जीवन स्वस्थ, सुखमय और खुशियों से भरा रहे।\n\nपाहिल वाटिका योगा ग्रुप की ओर से ढेर सारा प्यार और शुभकामनाएँ।",
  },
  {
    id: "fb-a", kind: "anniversary", lang: "hi", is_default: true, title: "विवाह वर्षगाँठ की हार्दिक शुभकामनाएँ!",
    body: "आपका दाम्पत्य जीवन प्रेम, स्वास्थ्य और खुशियों से सदा भरा रहे।\n\nपाहिल वाटिका योगा ग्रुप की ओर से ढेर सारी शुभकामनाएँ।",
  },
];

const W = 1080;
const H = 1350;
const FONT = '"Noto Sans Devanagari", "Inter", sans-serif';

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    if (!para.trim()) {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of para.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxW && line) {
        out.push(line);
        line = word;
      } else line = test;
    }
    out.push(line);
  }
  return out;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = src;
  });
}

async function draw(canvas: HTMLCanvasElement, o: { title: string; body: string; name: string; sub: string; group: string; photo: HTMLImageElement | null; kind: "birthday" | "anniversary" }) {
  const ctx = canvas.getContext("2d")!;
  canvas.width = W;
  canvas.height = H;
  // Sunrise background
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#0F2921");
  bg.addColorStop(0.45, "#183D32");
  bg.addColorStop(0.8, "#33684A");
  bg.addColorStop(1, "#4C956C");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, H + 80, 40, W / 2, H + 80, 900);
  glow.addColorStop(0, "rgba(230,184,92,0.95)");
  glow.addColorStop(0.35, "rgba(230,184,92,0.35)");
  glow.addColorStop(1, "rgba(230,184,92,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  // Rays at the top
  ctx.save();
  ctx.translate(W / 2, 330);
  ctx.strokeStyle = "rgba(230,184,92,0.18)";
  ctx.lineWidth = 6;
  for (let i = 0; i < 24; i++) {
    ctx.rotate((Math.PI * 2) / 24);
    ctx.beginPath();
    ctx.moveTo(0, 230);
    ctx.lineTo(0, 300);
    ctx.stroke();
  }
  ctx.restore();
  // Gold frame
  ctx.strokeStyle = "rgba(230,184,92,0.75)";
  ctx.lineWidth = 4;
  ctx.strokeRect(40, 40, W - 80, H - 80);

  // Photo circle (or emoji)
  const cy = 330;
  ctx.save();
  ctx.beginPath();
  ctx.arc(W / 2, cy, 200, 0, Math.PI * 2);
  ctx.fillStyle = "#E6B85C";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(W / 2, cy, 188, 0, Math.PI * 2);
  ctx.clip();
  if (o.photo) {
    const s = Math.min(o.photo.naturalWidth, o.photo.naturalHeight);
    ctx.drawImage(o.photo, (o.photo.naturalWidth - s) / 2, (o.photo.naturalHeight - s) / 2, s, s, W / 2 - 188, cy - 188, 376, 376);
  } else {
    ctx.fillStyle = "#F7F4EA";
    ctx.fillRect(W / 2 - 188, cy - 188, 376, 376);
    ctx.font = `160px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(o.kind === "birthday" ? "🎂" : "💐", W / 2, cy + 10);
  }
  ctx.restore();

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  let y = 640;
  ctx.fillStyle = "#E6B85C";
  ctx.font = `700 64px ${FONT}`;
  for (const l of wrap(ctx, o.title, W - 180)) {
    ctx.fillText(l, W / 2, y);
    y += 82;
  }
  ctx.fillStyle = "#FFFFFF";
  ctx.font = `700 76px ${FONT}`;
  y += 10;
  for (const l of wrap(ctx, o.name, W - 180)) {
    ctx.fillText(l, W / 2, y);
    y += 88;
  }
  if (o.sub) {
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.font = `500 38px ${FONT}`;
    ctx.fillText(o.sub, W / 2, y);
    y += 56;
  }
  y += 24;
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.font = `400 40px ${FONT}`;
  const lines = wrap(ctx, o.body, W - 200).slice(0, 9);
  for (const l of lines) {
    if (y > H - 200) break;
    ctx.fillText(l, W / 2, y);
    y += l ? 58 : 30;
  }
  // Footer
  ctx.fillStyle = "#183D32";
  ctx.font = `700 40px ${FONT}`;
  ctx.fillText(o.group, W / 2, H - 120);
  ctx.font = `500 30px ${FONT}`;
  ctx.fillText("एक परिवार, एक पहचान।", W / 2, H - 74);
}

export function GreetingCard({ open, onClose, kind, name, photoUrl, years }: {
  open: boolean;
  onClose: () => void;
  kind: "birthday" | "anniversary";
  name: string;
  photoUrl?: string | null;
  years?: number | null;
}) {
  const toast = useToast();
  const { site } = useAuth();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { data: templates } = useLoad(async () => {
    const { data } = await supabase.from("greeting_templates").select("*").eq("kind", kind).order("is_default", { ascending: false });
    return ((data as Template[] | null)?.length ? data : FALLBACK.filter((t) => t.kind === kind)) as Template[];
  }, [kind]);
  const [tplId, setTplId] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [rendering, setRendering] = useState(false);
  const photoRef = useRef<HTMLImageElement | null>(null);
  const [photoReady, setPhotoReady] = useState(0);

  useEffect(() => {
    if (!templates?.length) return;
    const t = templates.find((x) => x.lang === "hi" && x.is_default) ?? templates[0];
    setTplId(t.id);
    setTitle(t.title);
    setBody(t.body);
  }, [templates]);

  useEffect(() => {
    photoRef.current = null;
    if (!photoUrl || !open) return;
    loadImage(photoUrl).then((img) => {
      photoRef.current = img;
      setPhotoReady((n) => n + 1);
    });
  }, [photoUrl, open]);

  const sub = years
    ? kind === "birthday" ? `${years}वाँ जन्मदिन · ${ordinal(years)} birthday` : `${years}वीं वर्षगाँठ · ${ordinal(years)} anniversary`
    : "";

  const render = useCallback(async () => {
    const c = canvasRef.current;
    if (!c) return;
    try {
      await Promise.all([document.fonts.load(`700 64px "Noto Sans Devanagari"`), document.fonts.load(`400 40px "Noto Sans Devanagari"`)]);
    } catch {
      /* draw with fallback fonts */
    }
    await draw(c, { title, body, name, sub, group: site.name_hi, photo: photoRef.current, kind });
  }, [title, body, name, sub, site.name_hi, kind]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(render, 120);
    return () => clearTimeout(t);
  }, [open, render, photoReady]);

  const toBlob = async (): Promise<Blob> => {
    const c = canvasRef.current!;
    await render();
    try {
      return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Could not create image"))), "image/png"));
    } catch {
      // Canvas tainted by a photo without CORS headers — redraw without it.
      photoRef.current = null;
      await render();
      return new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Could not create image"))), "image/png"));
    }
  };

  const fileName = `${kind === "birthday" ? "janmdin" : "salgirah"}-${name.replace(/[^\wऀ-ॿ]+/g, "-")}.png`;

  const download = async () => {
    setRendering(true);
    try {
      const blob = await toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      toast.error(e);
    } finally {
      setRendering(false);
    }
  };

  const share = async () => {
    const text = `${title}\n\n${name}${sub ? ` — ${sub}` : ""}\n\n${body}`;
    setRendering(true);
    try {
      const blob = await toBlob();
      const file = new File([blob], fileName, { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text, title });
      } else {
        window.open(whatsappUrl(text), "_blank", "noopener");
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") window.open(whatsappUrl(text), "_blank", "noopener");
    } finally {
      setRendering(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={kind === "birthday" ? "जन्मदिन शुभकामना कार्ड · Birthday card" : "सालगिरह शुभकामना कार्ड · Anniversary card"}
      footer={
        <>
          <Button variant="secondary" icon={<Download className="h-4 w-4" />} loading={rendering} onClick={download}>डाउनलोड</Button>
          <Button variant="gold" icon={<Share2 className="h-4 w-4" />} loading={rendering} onClick={share}>शेयर करें · Share</Button>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-[1fr_260px]">
        <div className="space-y-3">
          <Field label="संदेश चुनें · Template">
            <Select
              value={tplId}
              onChange={(e) => {
                const t = templates?.find((x) => x.id === e.target.value);
                if (!t) return;
                setTplId(t.id);
                setTitle(t.title);
                setBody(t.body);
              }}
            >
              {templates?.map((t) => <option key={t.id} value={t.id}>{t.lang === "hi" ? "हिंदी" : "English"} · {t.title}</option>)}
            </Select>
          </Field>
          <Field label="शीर्षक · Heading">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />
          </Field>
          <Field label="संदेश · Message" hint="You can edit the wishes before sharing">
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6} maxLength={500} />
          </Field>
        </div>
        <canvas ref={canvasRef} width={W} height={H} className="mx-auto w-full max-w-[260px] rounded-2xl shadow-card" aria-label="Greeting card preview" />
      </div>
    </Modal>
  );
}
