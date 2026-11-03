"use client";
// Design-system primitives. Every page builds from these so spacing, type,
// colours and states stay consistent.
import { AlertTriangle, Inbox, Loader2, X } from "lucide-react";
import Link from "next/link";
import {
  forwardRef, useEffect, useRef, useState,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from "react";
import { clsx, initials } from "@/lib/format";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "gold";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-forest text-white hover:bg-forest-700 shadow-sm",
  secondary: "bg-white text-forest border border-forest/15 hover:bg-cream-100 hover:border-forest/30",
  ghost: "text-forest hover:bg-forest/5",
  danger: "bg-red-600 text-white hover:bg-red-700",
  gold: "bg-gold text-forest-900 hover:bg-gold-600 shadow-sm",
};
const SIZES: Record<Size, string> = {
  sm: "h-9 px-3 text-sm gap-1.5",
  md: "h-11 px-4 text-[15px] gap-2",
  lg: "h-12 px-6 text-base gap-2",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, icon, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={clsx(
        "inline-flex select-none items-center justify-center rounded-xl font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-55",
        VARIANTS[variant], SIZES[size], className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

/** Link styled like a button. Internal hrefs ("/events/") must NOT include the base path. */
export function LinkButton({ href, variant = "primary", size = "md", icon, className, children, external }: {
  href: string; variant?: Variant; size?: Size; icon?: ReactNode; className?: string; children: ReactNode; external?: boolean;
}) {
  const cls = clsx(
    "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2",
    VARIANTS[variant], SIZES[size], className,
  );
  // Internal paths go through next/link, which adds the GitHub Pages base path.
  if (!external && href.startsWith("/")) {
    return <Link href={href} className={cls}>{icon}{children}</Link>;
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
      {icon}
      {children}
    </a>
  );
}

export function Card({ className, children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={clsx("rounded-2xl border border-forest/5 bg-white shadow-card", className)} {...rest}>
      {children}
    </div>
  );
}

export function SectionTitle({ hi, en, action, className }: { hi: string; en?: string; action?: ReactNode; className?: string }) {
  return (
    <div className={clsx("mb-4 flex items-end justify-between gap-3", className)}>
      <div>
        <h2 className="font-hindi text-xl font-semibold text-forest sm:text-2xl">{hi}</h2>
        {en && <p className="text-sm text-muted">{en}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ hi, en, children }: { hi: string; en?: string; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="font-hindi text-2xl font-bold text-forest sm:text-3xl">{hi}</h1>
        {en && <p className="mt-0.5 text-muted">{en}</p>}
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- form fields
export function Field({ label, hint, error, required, children, className }: {
  label: string; hint?: string; error?: string | null; required?: boolean; children: ReactNode; className?: string;
}) {
  return (
    <label className={clsx("block", className)}>
      <span className="mb-1.5 block text-sm font-medium text-forest">
        {label}
        {required && <span className="text-red-600"> *</span>}
      </span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-muted">{hint}</span>}
      {error && <span className="mt-1 block text-xs font-medium text-red-600">{error}</span>}
    </label>
  );
}

const inputCls =
  "w-full rounded-xl border border-forest/15 bg-white px-3.5 text-[15px] text-forest-900 placeholder:text-muted-300 " +
  "focus:border-leaf focus:outline-none focus:ring-2 focus:ring-leaf/25 disabled:bg-cream-100";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={clsx(inputCls, "h-11", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={clsx(inputCls, "min-h-[96px] py-2.5", className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={clsx(inputCls, "h-11 pr-8", className)} {...rest}>
      {children}
    </select>
  );
});

export function Toggle({ checked, onChange, label, hint, disabled }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean;
}) {
  return (
    <label className={clsx("flex cursor-pointer items-start gap-3 py-1", disabled && "opacity-60")}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx(
          "relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold",
          checked ? "bg-leaf" : "bg-muted-300",
        )}
      >
        <span className={clsx("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all", checked ? "left-[22px]" : "left-0.5")} />
      </button>
      <span>
        <span className="block text-[15px] text-forest">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
    </label>
  );
}

// ---------------------------------------------------------------- feedback
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx("h-6 w-6 animate-spin text-leaf", className)} aria-label="Loading" />;
}

export function Loading({ label = "लोड हो रहा है… Loading" }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted" role="status">
      <Spinner className="h-8 w-8" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("animate-pulse rounded-xl bg-cream-200", className)} />;
}

export function EmptyState({ icon, title, text, action }: { icon?: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-forest/15 bg-white/60 px-6 py-12 text-center">
      <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-leaf-50 text-leaf">{icon ?? <Inbox className="h-7 w-7" />}</div>
      <p className="font-hindi text-lg font-semibold text-forest">{title}</p>
      {text && <p className="mt-1 max-w-sm text-sm text-muted">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-6 py-8 text-center" role="alert">
      <AlertTriangle className="h-7 w-7 text-red-600" />
      <p className="text-sm text-red-800">{message}</p>
      {onRetry && <Button variant="secondary" size="sm" onClick={onRetry}>पुनः प्रयास करें · Retry</Button>}
    </div>
  );
}

export function Badge({ children, tone = "green", className }: { children: ReactNode; tone?: "green" | "gold" | "grey" | "red" | "forest"; className?: string }) {
  const tones = {
    green: "bg-leaf-50 text-leaf-700",
    gold: "bg-gold-100 text-gold-700",
    grey: "bg-cream-200 text-muted",
    red: "bg-red-50 text-red-700",
    forest: "bg-forest text-white",
  };
  return <span className={clsx("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium", tones[tone], className)}>{children}</span>;
}

// ---------------------------------------------------------------- avatar
export function Avatar({ name, src, size = 48, className }: { name: string; src?: string | null; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size, fontSize: Math.max(12, size * 0.36) };
  if (src && !failed) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={name} style={style} onError={() => setFailed(true)} className={clsx("shrink-0 rounded-full object-cover ring-2 ring-white", className)} loading="lazy" />;
  }
  return (
    <span style={style} className={clsx("inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-leaf to-forest font-semibold text-white ring-2 ring-white", className)} aria-label={name}>
      {initials(name) || "?"}
    </span>
  );
}

// ---------------------------------------------------------------- modal
export function Modal({ open, onClose, title, children, footer, wide }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    setTimeout(() => panel.current?.querySelector<HTMLElement>("input,select,textarea,button")?.focus(), 30);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-forest-900/50 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={clsx(
          "flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-3xl bg-cream-100 shadow-lift animate-fade-up sm:rounded-3xl",
          wide ? "sm:max-w-3xl" : "sm:max-w-lg",
        )}
      >
        <div className="flex items-center justify-between border-b border-forest/10 px-5 py-4">
          <h2 className="font-hindi text-lg font-semibold text-forest">{title}</h2>
          <button onClick={onClose} className="rounded-full p-2 text-muted hover:bg-forest/5" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-forest/10 bg-white/60 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>
  );
}

/** Promise-free confirm dialog for destructive actions. */
export function ConfirmDialog({ open, title, message, confirmLabel = "हाँ, करें · Confirm", danger = true, loading, onConfirm, onCancel, children }: {
  open: boolean; title: string; message: ReactNode; confirmLabel?: string; danger?: boolean; loading?: boolean;
  onConfirm: () => void; onCancel: () => void; children?: ReactNode;
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={loading}>रद्द करें · Cancel</Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} loading={loading}>{confirmLabel}</Button>
        </>
      }
    >
      <div className="text-[15px] text-forest-900">{message}</div>
      {children}
    </Modal>
  );
}

// ---------------------------------------------------------------- tabs
export function Tabs<T extends string>({ value, onChange, items, className }: {
  value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode }[]; className?: string;
}) {
  return (
    <div className={clsx("no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1", className)} role="tablist">
      {items.map((it) => (
        <button
          key={it.value}
          role="tab"
          aria-selected={value === it.value}
          onClick={() => onChange(it.value)}
          className={clsx(
            "h-10 shrink-0 rounded-full px-4 text-sm font-medium transition-colors",
            value === it.value ? "bg-forest text-white" : "bg-white text-forest shadow-sm hover:bg-cream-200",
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function StatCard({ label, value, icon, tone = "green", sub }: { label: string; value: ReactNode; icon?: ReactNode; tone?: "green" | "gold" | "forest" | "red"; sub?: ReactNode }) {
  const tones = { green: "bg-leaf-50 text-leaf-700", gold: "bg-gold-100 text-gold-700", forest: "bg-forest-50 text-forest", red: "bg-red-50 text-red-700" };
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        {icon && <span className={clsx("flex h-10 w-10 items-center justify-center rounded-xl", tones[tone])}>{icon}</span>}
        <div className="min-w-0">
          <p className="truncate text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
          <p className="truncate text-xl font-bold text-forest">{value}</p>
          {sub && <p className="text-xs text-muted">{sub}</p>}
        </div>
      </div>
    </Card>
  );
}
