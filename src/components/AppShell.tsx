"use client";
import {
  Bell, CakeSlice, CalendarDays, Home, Images, IndianRupee, LayoutDashboard, LogIn, LogOut, Menu, Music2, Settings, User, Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import { ROLE_LABELS, useAuth } from "@/lib/auth";
import { clsx } from "@/lib/format";
import { isConfigured } from "@/lib/supabase";
import { MiniPlayer } from "./AudioPlayer";
import { Logo } from "./Logo";
import { SetupNotice } from "./SetupNotice";
import { Loading } from "./ui";

const MAIN = [
  { href: "/", hi: "होम", en: "Home", icon: Home },
  { href: "/members/", hi: "परिवार", en: "Parivaar", icon: Users },
  { href: "/gallery/", hi: "यादें", en: "Memories", icon: Images },
  { href: "/events/", hi: "कार्यक्रम", en: "Events", icon: CalendarDays },
];

export const MORE_LINKS = [
  { href: "/hisaab/", hi: "हिसाब-किताब", en: "Hisaab-Kitab", icon: IndianRupee },
  { href: "/celebrations/", hi: "जन्मदिन व सालगिरह", en: "Birthdays", icon: CakeSlice },
  { href: "/song/", hi: "परिवार गीत", en: "Theme Song", icon: Music2 },
  { href: "/announcements/", hi: "सूचनाएँ", en: "Announcements", icon: Bell },
  { href: "/profile/", hi: "मेरी प्रोफ़ाइल", en: "Profile", icon: User },
  { href: "/admin/", hi: "प्रबंधन", en: "Admin dashboard", icon: LayoutDashboard, admin: true },
  { href: "/admin/?tab=settings", hi: "सेटिंग्स", en: "Settings", icon: Settings, admin: true },
];

function isActive(path: string, href: string) {
  if (href === "/") return path === "/";
  return path.startsWith(href.replace(/\?.*$/, ""));
}

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname() || "/";
  const auth = useAuth();
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => setMoreOpen(false), [path]);

  if (!isConfigured) return <SetupNotice />;

  const moreActive = !MAIN.some((m) => isActive(path, m.href)) && path !== "/login/";
  const staff = auth.isAdmin || auth.isTreasurer;

  return (
    <div className="min-h-screen bg-cream">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[200] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>
      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b border-forest/5 bg-cream/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4">
          <Link href="/" className="flex min-w-0 items-center gap-2.5">
            <Logo className="h-10 w-10 shrink-0" />
            <span className="min-w-0 leading-tight">
              <span className="block truncate font-hindi text-[15px] font-bold text-forest sm:text-base">पाहिल वाटिका योगा ग्रुप</span>
              <span className="block truncate text-[11px] uppercase tracking-[0.14em] text-leaf">Khajuraho · योग परिवार</span>
            </span>
          </Link>
          <nav className="hidden items-center gap-1 lg:flex" aria-label="Main">
            {[...MAIN, ...MORE_LINKS.slice(0, 4)].map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={clsx(
                  "rounded-full px-3 py-2 text-sm font-medium transition-colors",
                  isActive(path, l.href) ? "bg-forest text-white" : "text-forest hover:bg-forest/5",
                )}
              >
                <span className="font-hindi">{l.hi}</span>
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-1">
            {staff && (
              <Link href="/admin/" className="inline-flex h-10 items-center gap-1.5 rounded-full bg-gold px-3 text-sm font-semibold text-forest-900" aria-label="Admin dashboard">
                <LayoutDashboard className="h-4 w-4" /> <span className="hidden min-[380px]:inline">Admin</span>
              </Link>
            )}
            {auth.user ? (
              <Link href="/profile/" className="hidden h-10 items-center gap-2 rounded-full px-3 text-sm text-forest hover:bg-forest/5 md:inline-flex">
                <User className="h-4 w-4" />
                <span className="max-w-[9rem] truncate">{auth.profile?.display_name ?? "Profile"}</span>
              </Link>
            ) : (
              !auth.loading && (
                <Link href="/login/" className="inline-flex h-10 items-center gap-1.5 rounded-full bg-forest px-4 text-sm font-medium text-white">
                  <LogIn className="h-4 w-4" /> <span className="font-hindi">लॉगिन</span>
                </Link>
              )
            )}
            <button onClick={() => setMoreOpen(true)} className="hidden rounded-full p-2.5 text-forest hover:bg-forest/5 md:inline-flex lg:hidden" aria-label="Menu">
              <Menu className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      {auth.user && auth.profile && !auth.profile.approved && (
        <div className="bg-gold-100 px-4 py-2.5 text-center text-sm text-gold-700">
          आपका खाता स्वीकृति के लिए प्रतीक्षा में है · Your account is waiting for admin approval. Until then you can see public content only.
        </div>
      )}

      <main id="main" className="mx-auto max-w-6xl px-4 pb-32 pt-5 md:pb-16">
        {/* Boundary for useSearchParams in client pages (required for static export) */}
        <Suspense fallback={<Loading />}>{children}</Suspense>
      </main>

      <Footer />
      <MiniPlayer />

      {/* Bottom navigation (mobile) */}
      <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-forest/10 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden" aria-label="Bottom">
        <div className="mx-auto grid max-w-md grid-cols-5">
          {MAIN.map(({ href, hi, en, icon: Icon }) => {
            const active = isActive(path, href);
            return (
              <Link key={href} href={href} className={clsx("flex flex-col items-center gap-0.5 py-2 text-[11px]", active ? "text-forest" : "text-muted")} aria-current={active ? "page" : undefined}>
                <span className={clsx("flex h-8 w-12 items-center justify-center rounded-full transition-colors", active && "bg-leaf-100")}>
                  <Icon className="h-[22px] w-[22px]" strokeWidth={active ? 2.4 : 2} />
                </span>
                <span className="font-hindi leading-none">{hi}</span>
                <span className="sr-only">{en}</span>
              </Link>
            );
          })}
          <button onClick={() => setMoreOpen(true)} className={clsx("flex flex-col items-center gap-0.5 py-2 text-[11px]", moreActive ? "text-forest" : "text-muted")}>
            <span className={clsx("flex h-8 w-12 items-center justify-center rounded-full", moreActive && "bg-leaf-100")}>
              <Menu className="h-[22px] w-[22px]" />
            </span>
            <span className="font-hindi leading-none">और</span>
            <span className="sr-only">More</span>
          </button>
        </div>
      </nav>

      {moreOpen && <MoreSheet onClose={() => setMoreOpen(false)} />}
    </div>
  );
}

function MoreSheet({ onClose }: { onClose: () => void }) {
  const auth = useAuth();
  const staff = auth.isAdmin || auth.isTreasurer;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[60] flex items-end bg-forest-900/45 md:items-start md:justify-end" onClick={onClose}>
      <div className="w-full animate-fade-up rounded-t-3xl bg-cream-100 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] md:m-3 md:w-80 md:rounded-3xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="More">
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-muted-300 md:hidden" />
        {auth.user && (
          <div className="mb-3 rounded-2xl bg-white p-3 text-sm">
            <p className="font-semibold text-forest">{auth.profile?.display_name}</p>
            <p className="text-muted">{auth.role ? ROLE_LABELS[auth.role] : "Awaiting approval"} · {auth.user.email}</p>
          </div>
        )}
        <div className="grid grid-cols-3 gap-2">
          {[...MAIN.slice(1), ...MORE_LINKS].filter((l) => !("admin" in l && l.admin) || staff).map(({ href, hi, en, icon: Icon }) => (
            <Link key={href} href={href} onClick={onClose} className="flex flex-col items-center gap-1.5 rounded-2xl bg-white p-3 text-center shadow-sm active:scale-[0.98]">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-leaf-50 text-leaf-700"><Icon className="h-5 w-5" /></span>
              <span className="font-hindi text-[13px] font-medium leading-tight text-forest">{hi}</span>
              <span className="text-[10px] leading-tight text-muted">{en}</span>
            </Link>
          ))}
        </div>
        <div className="mt-3">
          {auth.user ? (
            <button onClick={() => { auth.signOut(); onClose(); }} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-white text-[15px] font-medium text-red-700">
              <LogOut className="h-4 w-4" /> लॉग आउट · Sign out
            </button>
          ) : (
            <Link href="/login/" onClick={onClose} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-forest text-[15px] font-medium text-white">
              <LogIn className="h-4 w-4" /> लॉगिन · Sign in
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

function Footer() {
  const { site } = useAuth();
  return (
    <footer className="border-t border-forest/10 bg-forest text-cream">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 pb-28 pt-10 md:grid-cols-3 md:pb-10">
        <div>
          <div className="flex items-center gap-3">
            <Logo className="h-12 w-12" light />
            <div>
              <p className="font-hindi text-lg font-bold">{site.name_hi}</p>
              <p className="text-sm text-cream/70">{site.name_en}</p>
            </div>
          </div>
          <p className="mt-4 font-hindi text-gold">{site.tagline}</p>
          <p className="font-hindi text-sm text-cream/80">{site.subtagline}</p>
        </div>
        <div className="text-sm">
          <p className="mb-2 font-semibold uppercase tracking-wider text-gold">संपर्क · Contact</p>
          {site.address && <p className="font-hindi text-cream/85">{site.address}</p>}
          {site.session_time && <p className="mt-1 text-cream/85">🧘 {site.session_time}</p>}
          {site.contact_phone && <p className="mt-1"><a className="hover:text-gold" href={`tel:${site.contact_phone}`}>📞 {site.contact_phone}</a></p>}
          {site.contact_email && <p className="mt-1"><a className="hover:text-gold" href={`mailto:${site.contact_email}`}>✉️ {site.contact_email}</a></p>}
        </div>
        <div className="text-sm">
          <p className="mb-2 font-semibold uppercase tracking-wider text-gold">परिवार · Explore</p>
          <ul className="grid grid-cols-2 gap-1.5 text-cream/85">
            {[...MAIN, ...MORE_LINKS.slice(0, 4)].map((l) => (
              <li key={l.href}><Link className="font-hindi hover:text-gold" href={l.href}>{l.hi}</Link></li>
            ))}
          </ul>
        </div>
      </div>
      <p className="border-t border-white/10 py-4 text-center font-hindi text-sm text-cream/70">“{site.message}”</p>
    </footer>
  );
}
