const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2, minimumFractionDigits: 0 });

export function money(n: number | string | null | undefined): string {
  return inr.format(Number(n ?? 0));
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

/** WhatsApp share link (works on phones and WhatsApp Web). */
export function whatsappUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/** Absolute URL to a page of this site (for sharing). */
export function siteUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  if (typeof window === "undefined") return `${base}${path}`;
  return `${window.location.origin}${base}${path}`;
}

/** Neutralise values that spreadsheet apps would treat as formulas when exporting. */
export function safeCell(v: unknown): string | number {
  if (typeof v === "number") return v;
  const s = String(v ?? "");
  return /^[=+\-@]/.test(s) ? `'${s}` : s;
}

export function clsx(...xs: (string | false | null | undefined)[]): string {
  return xs.filter(Boolean).join(" ");
}
