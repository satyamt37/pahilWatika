"use client";
import {
  Bell, CakeSlice, CalendarDays, FileSpreadsheet, FolderHeart, Gauge, Images, IndianRupee, Music2, ScrollText, Settings, ShieldCheck, Users,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type ComponentType } from "react";
import AlbumsAdmin from "@/components/admin/AlbumsAdmin";
import AnnouncementsAdmin from "@/components/admin/AnnouncementsAdmin";
import AuditAdmin from "@/components/admin/AuditAdmin";
import CelebrationsAdmin from "@/components/admin/CelebrationsAdmin";
import EventsAdmin from "@/components/admin/EventsAdmin";
import FinanceAdmin from "@/components/admin/FinanceAdmin";
import ImportAdmin from "@/components/admin/ImportAdmin";
import MembersAdmin from "@/components/admin/MembersAdmin";
import OverviewAdmin from "@/components/admin/OverviewAdmin";
import PhotosAdmin from "@/components/admin/PhotosAdmin";
import RolesAdmin from "@/components/admin/RolesAdmin";
import SettingsAdmin from "@/components/admin/SettingsAdmin";
import SongAdmin from "@/components/admin/SongAdmin";
import { Guard } from "@/components/Guard";
import { PageHeader } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { clsx } from "@/lib/format";
import { setQueryParam } from "@/lib/hooks";

type Who = "admin" | "treasurer" | "staff" | "super_admin";
const TABS: { key: string; hi: string; en: string; icon: ComponentType<{ className?: string }>; who: Who; C: ComponentType }[] = [
  { key: "overview", hi: "अवलोकन", en: "Overview", icon: Gauge, who: "staff", C: OverviewAdmin },
  { key: "members", hi: "सदस्य", en: "Members", icon: Users, who: "admin", C: MembersAdmin },
  { key: "photos", hi: "फ़ोटो", en: "Photos", icon: Images, who: "admin", C: PhotosAdmin },
  { key: "albums", hi: "एल्बम", en: "Albums", icon: FolderHeart, who: "admin", C: AlbumsAdmin },
  { key: "events", hi: "कार्यक्रम व कैलेंडर", en: "Events & calendar", icon: CalendarDays, who: "admin", C: EventsAdmin },
  { key: "import", hi: "एक्सेल इम्पोर्ट", en: "Excel import", icon: FileSpreadsheet, who: "staff", C: ImportAdmin },
  { key: "celebrations", hi: "जन्मदिन व सुविचार", en: "Birthdays & thoughts", icon: CakeSlice, who: "admin", C: CelebrationsAdmin },
  { key: "song", hi: "परिवार गीत", en: "Theme song", icon: Music2, who: "admin", C: SongAdmin },
  { key: "finance", hi: "हिसाब-किताब", en: "Hisaab-Kitab", icon: IndianRupee, who: "treasurer", C: FinanceAdmin },
  { key: "announcements", hi: "सूचनाएँ", en: "Announcements", icon: Bell, who: "admin", C: AnnouncementsAdmin },
  { key: "roles", hi: "भूमिकाएँ", en: "Users & roles", icon: ShieldCheck, who: "admin", C: RolesAdmin },
  { key: "settings", hi: "सेटिंग्स", en: "Website settings", icon: Settings, who: "admin", C: SettingsAdmin },
  { key: "audit", hi: "ऑडिट लॉग", en: "Audit logs", icon: ScrollText, who: "staff", C: AuditAdmin },
];

export default function AdminPage() {
  return (
    <Guard need="staff">
      <Suspense>
        <AdminInner />
      </Suspense>
    </Guard>
  );
}

function AdminInner() {
  const a = useAuth();
  const allowed = TABS.filter((t) =>
    t.who === "staff" ? a.isAdmin || a.isTreasurer
      : t.who === "admin" ? a.isAdmin
        : t.who === "treasurer" ? a.isTreasurer
          : a.isSuperAdmin,
  );
  const params = useSearchParams();
  const fromUrl = params.get("tab");
  const [tab, setTab] = useState("overview");
  // Follow ?tab= on first load and on in-app links such as "/admin/?tab=roles".
  useEffect(() => {
    if (fromUrl) setTab(fromUrl);
  }, [fromUrl]);
  const current = allowed.find((t) => t.key === tab) ?? allowed[0];
  const select = (k: string) => {
    setTab(k);
    setQueryParam("tab", k);
    window.scrollTo({ top: 0 });
  };

  return (
    <div>
      <PageHeader hi="प्रबंधन डैशबोर्ड" en="Admin dashboard" />
      <div className="flex flex-col gap-5 lg:flex-row">
        <nav className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 lg:mx-0 lg:w-60 lg:shrink-0 lg:flex-col lg:overflow-visible lg:px-0" aria-label="Admin sections">
          {allowed.map(({ key, hi, en, icon: Icon }) => (
            <button
              key={key}
              onClick={() => select(key)}
              className={clsx(
                "flex h-11 shrink-0 items-center gap-2.5 rounded-xl px-3.5 text-left text-sm font-medium transition-colors",
                current.key === key ? "bg-forest text-white shadow-sm" : "bg-white text-forest hover:bg-cream-200",
              )}
              aria-current={current.key === key ? "page" : undefined}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="font-hindi">{hi}</span>
              <span className="hidden text-xs opacity-70 xl:inline">· {en}</span>
            </button>
          ))}
        </nav>
        <section className="min-w-0 flex-1" aria-label={current.en}>
          <h2 className="mb-4 font-hindi text-xl font-semibold text-forest">{current.hi} <span className="text-base font-normal text-muted">· {current.en}</span></h2>
          <current.C />
        </section>
      </div>
    </div>
  );
}
