"use client";
import { CakeSlice, ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { type CelebMember, useCelebrationMembers } from "@/components/celebrations/data";
import { GreetingCard } from "@/components/celebrations/GreetingCard";
import { Guard } from "@/components/Guard";
import { Avatar, Button, Card, EmptyState, ErrorState, Loading, PageHeader, SectionTitle, Tabs } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import {
  MONTHS_EN, MONTHS_HI, celebrationsInMonth, dayMonthLabel, ordinal, relativeDays, todayIST, upcomingCelebrations,
} from "@/lib/dates";
import { clsx } from "@/lib/format";

type Wish = { kind: "birthday" | "anniversary"; m: CelebMember; years: number | null };
type Filter = "all" | "birthday" | "anniversary";

export default function CelebrationsPage() {
  return (
    <div>
      <PageHeader hi="जन्मदिन व सालगिरह" en="Birthdays & anniversaries" />
      <Guard need="member">
        <Inner />
      </Guard>
    </div>
  );
}

function Inner() {
  const { isMember } = useAuth();
  const { data, error, loading, reload } = useCelebrationMembers(isMember);
  const [wish, setWish] = useState<Wish | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const t = todayIST();
  const [ym, setYm] = useState({ y: t.y, m: t.m });

  const members = data?.members ?? [];
  const photos = data?.photos ?? {};
  const all30 = useMemo(() => upcomingCelebrations(members, 30).filter((c) => filter === "all" || c.kind === filter), [members, filter]);
  const today = all30.filter((c) => c.daysUntil === 0);
  const week = all30.filter((c) => c.daysUntil > 0 && c.daysUntil <= 7);
  const month = all30.filter((c) => c.daysUntil > 7);
  const monthly = useMemo(() => celebrationsInMonth(members, ym.y, ym.m).filter((c) => filter === "all" || c.kind === filter), [members, ym, filter]);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorState message={error} onRetry={reload} />;

  const shift = (n: number) => {
    const d = new Date(Date.UTC(ym.y, ym.m - 1 + n, 1));
    setYm({ y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 });
  };

  const Row = ({ c }: { c: (typeof all30)[number] }) => (
    <Card className="flex items-center gap-3 p-3">
      <Avatar name={c.item.full_name} src={c.item.photo_path ? photos[c.item.photo_path] : null} size={52} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-forest">{c.item.full_name}</p>
        <p className="text-sm text-muted">
          {c.kind === "birthday" ? "🎂 जन्मदिन" : "💐 सालगिरह"} · {dayMonthLabel(c.day, c.month, "hi")}
          {c.years ? ` · ${c.kind === "birthday" ? `${c.years} वर्ष` : `${ordinal(c.years)}`}` : ""}
        </p>
        <p className={clsx("text-xs font-medium", c.daysUntil === 0 ? "text-gold-700" : "text-leaf-700")}>{relativeDays(c.daysUntil)}</p>
      </div>
      <Button size="sm" variant={c.daysUntil === 0 ? "gold" : "secondary"} onClick={() => setWish({ kind: c.kind, m: c.item, years: c.years })}>
        {c.daysUntil === 0 ? "शुभकामनाएँ" : "कार्ड"}
      </Button>
    </Card>
  );

  return (
    <div className="space-y-8">
      <Tabs<Filter>
        value={filter}
        onChange={setFilter}
        items={[{ value: "all", label: "सभी · All" }, { value: "birthday", label: "🎂 जन्मदिन" }, { value: "anniversary", label: "💐 सालगिरह" }]}
      />

      <section>
        <SectionTitle hi="आज" en="Today" />
        {today.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {today.map((c) => (
              <Card key={`${c.kind}-${c.item.id}`} className="overflow-hidden">
                <div className="flex items-center gap-4 bg-sunrise p-5 text-white">
                  <Avatar name={c.item.full_name} src={c.item.photo_path ? photos[c.item.photo_path] : null} size={80} />
                  <div className="min-w-0">
                    <p className="text-sm text-gold">{c.kind === "birthday" ? "🎂 जन्मदिन की हार्दिक शुभकामनाएँ!" : "💐 सालगिरह की हार्दिक शुभकामनाएँ!"}</p>
                    <p className="truncate font-hindi text-xl font-bold">{c.item.full_name}</p>
                    {c.years && <p className="text-sm text-white/80">{c.kind === "birthday" ? `${c.years}वाँ जन्मदिन` : `${c.years}वीं वर्षगाँठ`}</p>}
                  </div>
                </div>
                <div className="p-3">
                  <Button variant="gold" className="w-full" onClick={() => setWish({ kind: c.kind, m: c.item, years: c.years })}>शुभकामना कार्ड भेजें · Send a card</Button>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <p className="rounded-2xl bg-white p-4 text-sm text-muted">आज कोई जन्मदिन या सालगिरह नहीं · Nothing to celebrate today.</p>
        )}
      </section>

      <section>
        <SectionTitle hi="अगले 7 दिन" en="Next 7 days" />
        {week.length ? <div className="grid gap-2 md:grid-cols-2">{week.map((c) => <Row key={`${c.kind}-${c.item.id}`} c={c} />)}</div> : <p className="text-sm text-muted">कोई नहीं · None.</p>}
      </section>

      <section>
        <SectionTitle hi="अगले 30 दिन" en="Next 30 days" />
        {month.length ? <div className="grid gap-2 md:grid-cols-2">{month.map((c) => <Row key={`${c.kind}-${c.item.id}`} c={c} />)}</div> : <p className="text-sm text-muted">कोई नहीं · None.</p>}
      </section>

      <section>
        <SectionTitle
          hi="मासिक कैलेंडर"
          en="Monthly celebrations"
          action={
            <div className="flex items-center gap-1">
              <button onClick={() => shift(-1)} className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-forest/5" aria-label="Previous month"><ChevronLeft className="h-5 w-5" /></button>
              <span className="min-w-[8rem] text-center font-hindi font-semibold text-forest">{MONTHS_HI[ym.m - 1]} {ym.y}<span className="block text-xs font-normal text-muted">{MONTHS_EN[ym.m - 1]}</span></span>
              <button onClick={() => shift(1)} className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-forest/5" aria-label="Next month"><ChevronRight className="h-5 w-5" /></button>
            </div>
          }
        />
        {monthly.length ? (
          <Card className="divide-y divide-forest/5">
            {monthly.map((c) => (
              <div key={`${c.kind}-${c.item.id}`} className="flex items-center gap-3 p-3">
                <span className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl bg-leaf-50 text-forest">
                  <span className="text-lg font-bold leading-none">{c.day}</span>
                  <span className="text-[10px] uppercase">{MONTHS_EN[ym.m - 1].slice(0, 3)}</span>
                </span>
                <Avatar name={c.item.full_name} src={c.item.photo_path ? photos[c.item.photo_path] : null} size={40} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-forest">{c.item.full_name}</span>
                  <span className="text-sm text-muted">{c.kind === "birthday" ? "🎂 जन्मदिन" : "💐 सालगिरह"}{c.years ? ` · ${c.years}` : ""}</span>
                </span>
                <Button size="sm" variant="ghost" onClick={() => setWish({ kind: c.kind, m: c.item, years: c.years })}>कार्ड</Button>
              </div>
            ))}
          </Card>
        ) : (
          <EmptyState icon={<CakeSlice className="h-7 w-7" />} title="इस महीने कोई उत्सव नहीं" text="No birthdays or anniversaries this month." />
        )}
        <p className="mt-3 text-xs text-muted">Only dates that members have chosen to share are shown. 29 February birthdays are celebrated on 28 February in non-leap years.</p>
      </section>

      {wish && (
        <GreetingCard
          open
          onClose={() => setWish(null)}
          kind={wish.kind}
          name={wish.m.full_name}
          years={wish.years}
          photoUrl={wish.m.photo_path ? photos[wish.m.photo_path] : null}
        />
      )}
    </div>
  );
}
