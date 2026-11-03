// Browser-side media processing: compression, thumbnails, video posters, hashing.
// Compressing before upload keeps the gallery inside the free storage quota.

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];

export async function sha256(file: Blob): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function loadBitmap(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if ("createImageBitmap" in window) {
    try {
      // Respects EXIF orientation from phone cameras.
      return await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
    } catch {
      /* fall back for older browsers */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode image"))), type, quality),
  );
}

function drawScaled(src: CanvasImageSource, w: number, h: number, maxSide: number) {
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#ffffff"; // PNG transparency → white instead of black in JPEG
  ctx.fillRect(0, 0, cw, ch);
  ctx.drawImage(src, 0, 0, cw, ch);
  return { canvas, width: cw, height: ch };
}

export interface ProcessedImage {
  display: Blob; // ~2048px JPEG, used in the lightbox
  thumb: Blob; // ~480px JPEG, used in the grid
  width: number;
  height: number;
}

export async function processImage(file: Blob, opts: { maxSide?: number; thumbSide?: number; quality?: number } = {}): Promise<ProcessedImage> {
  const { maxSide = 2048, thumbSide = 480, quality = 0.85 } = opts;
  const bmp = await loadBitmap(file);
  const w = "naturalWidth" in bmp ? bmp.naturalWidth : bmp.width;
  const h = "naturalHeight" in bmp ? bmp.naturalHeight : bmp.height;
  const big = drawScaled(bmp, w, h, maxSide);
  let display = await canvasToBlob(big.canvas, "image/jpeg", quality);
  // A small, already-compressed original can be smaller than our re-encode.
  if (file.size < display.size && file.type === "image/jpeg" && Math.max(w, h) <= maxSide) display = file;
  const small = drawScaled(bmp, w, h, thumbSide);
  const thumb = await canvasToBlob(small.canvas, "image/jpeg", 0.78);
  if ("close" in bmp) bmp.close();
  return { display, thumb, width: big.width, height: big.height };
}

/** Square-cropped avatar (default 512px). */
export async function processAvatar(file: Blob, side = 512): Promise<Blob> {
  const bmp = await loadBitmap(file);
  const w = "naturalWidth" in bmp ? bmp.naturalWidth : bmp.width;
  const h = "naturalHeight" in bmp ? bmp.naturalHeight : bmp.height;
  const s = Math.min(w, h);
  const canvas = document.createElement("canvas");
  canvas.width = side;
  canvas.height = side;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, (w - s) / 2, (h - s) / 2, s, s, 0, 0, side, side);
  return canvasToBlob(canvas, "image/jpeg", 0.85);
}

/** Grab a poster frame from a video file for its grid thumbnail. */
export async function videoPoster(file: Blob): Promise<{ thumb: Blob; width: number; height: number } | null> {
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.src = url;
    await new Promise<void>((res, rej) => {
      video.onloadeddata = () => res();
      video.onerror = () => rej(new Error("Cannot read video"));
      setTimeout(() => rej(new Error("timeout")), 15000);
    });
    video.currentTime = Math.min(1, (video.duration || 2) / 2);
    await new Promise<void>((res) => {
      video.onseeked = () => res();
      setTimeout(res, 3000);
    });
    const { canvas } = drawScaled(video, video.videoWidth, video.videoHeight, 480);
    return { thumb: await canvasToBlob(canvas, "image/jpeg", 0.78), width: video.videoWidth, height: video.videoHeight };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Extract a YouTube video id from any common URL form. */
export function youtubeId(url: string): string | null {
  const m = /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/))([\w-]{11})/.exec(url);
  return m?.[1] ?? null;
}
