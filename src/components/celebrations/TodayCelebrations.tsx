"use client";
import { CakeSlice, Lock } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Avatar, Button, Card, EmptyState, ErrorState, LinkButton, Skeleton } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { dayMonthLabel, relativeDays, upcomingCelebrations, type Celebration } from "@/lib/dates";
import { type CelebMember, useCelebrationMembers } from "./data";
import { GreetingCard } from "./GreetingCard";

/** Homepage block: today's birthdays & anniversaries, else the next few within 30 days. */
export default function TodayCelebrations() {
  const { isMember, loading: authLoading } = useAuth();
  const { data, error, loading, reload } = useCelebrationMembers(isMember);
  const [wish, setWish] = useState<Celebration<CelebMember> | null>(null);

  const { today, upcoming } = useMemo(() => {
    const all = upcomingCelebrations(data?.members ?? [], 30);
    return { today: all.filter((c) => c.daysUntil === 0), upcoming: all.filter((c) => c.daysUntil > 0).slice(0, 3) };
  }, [data]);

  if (authLoading || (isMember && loading && !data)) return <Skeleton className="h-36" />;
  if (!isMember) {
    return (
      <EmptyState
        icon={<Lock className="h-7 w-7" />}
        title="जन्मदिन व सालगिरह"
        text="Birthdays and anniversaries are shared with parivaar members only. Please sign in to see today's celebrations."
        action={<LinkButton href="/login/?next=%2Fcelebrations%2F" size="sm">लॉगिन · Sign in</LinkButton>}
      />
    );
  }
  if (error) return <ErrorState message={error} onRetry={reload} />;

  const list = today.length ? today : upcoming;
  return (
    <div>
      {today.length ? (
        <p className="mb-3 font-hindi text-forest">🎉 आज के उत्सव · Celebrating today</p>
      ) : (
        <p className="mb-3 text-sm text-muted">आज कोई जन्मदिन या सालगिरह नहीं — आने वाले उत्सव · No celebrations today — coming up:</p>
      )}
      {!list.length ? (
        <EmptyState icon={<CakeSlice className="h-7 w-7" />} title="अगले 30 दिनों में कोई उत्सव नहीं" text="No birthdays or anniversaries in the next 30 days." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((c) => (
            <Card key={`${c.kind}-${c.item.id}`} className={today.length ? "bg-gradient-to-br from-gold-100 to-white p-4" : "p-4"}>
              <div className="flex items-center gap-3">
                <Avatar name={c.item.full_name} src={c.item.photo_path ? data?.photos[c.item.photo_path] : null} size={56} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-forest">{c.item.full_name}</p>
                  <p className="text-sm text-muted">
                    {c.kind === "birthday" ? "🎂 जन्मदिन" : "💐 सालगिरह"} · {dayMonthLabel(c.day, c.month, "hi")}
                    {c.years ? ` · ${c.years}` : ""}
                  </p>
                  <p className="text-xs font-medium text-leaf-700">{relativeDays(c.daysUntil)}</p>
                </div>
              </div>
              {c.daysUntil === 0 && (
                <Button size="sm" variant="gold" className="mt-3 w-full" onClick={() => setWish(c)}>शुभकामनाएँ भेजें · Send wishes</Button>
              )}
            </Card>
          ))}
        </div>
      )}
      <div className="mt-3 text-right">
        <Link href="/celebrations/" className="text-sm font-medium text-leaf-700 hover:underline">सभी उत्सव देखें · All celebrations →</Link>
      </div>
      {wish && (
        <GreetingCard
          open
          onClose={() => setWish(null)}
          kind={wish.kind}
          name={wish.item.full_name}
          years={wish.years}
          photoUrl={wish.item.photo_path ? data?.photos[wish.item.photo_path] : null}
        />
      )}
    </div>
  );
}
