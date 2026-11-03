"use client";
import { ArrowLeft, CakeSlice, CalendarCheck, Heart, MessageCircle, Pencil, Phone } from "lucide-react";
import Link from "next/link";
import { Avatar, Badge, Card, EmptyState, ErrorState, LinkButton, Loading } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { dayMonthLabel, formatDate, nextOccurrence, relativeDays } from "@/lib/dates";
import { money } from "@/lib/format";
import { useLoad, useQueryParam } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import type { DirectoryMember, LedgerRow } from "@/lib/types";
import { useSignedUrls } from "@/lib/useSigned";

export default function MemberViewPage() {
  const id = useQueryParam("id");
  const { user, isAdmin, canSeeFinance, loading: authLoading } = useAuth();

  const member = useLoad(async () => {
    if (!id) return null;
    const { data, error } = await supabase.from("member_directory").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data as DirectoryMember | null;
  }, [id, authLoading]);

  const contributions = useLoad(async () => {
    if (!id || !canSeeFinance) return [];
    const { data, error } = await supabase.from("fin_ledger").select("*").eq("member_id", id).order("txn_date", { ascending: false }).limit(50);
    if (error) throw error;
    return (data ?? []) as LedgerRow[];
  }, [id, canSeeFinance]);

  const m = member.data;
  const photo = useSignedUrls("gallery", [m?.photo_path]);

  if (!id && !member.loading) return <EmptyState title="सदस्य नहीं मिला" text="No member selected." />;
  if (member.error) return <ErrorState message={member.error} onRetry={member.reload} />;
  if (member.loading || authLoading) return <Loading />;
  if (!m) return <EmptyState title="सदस्य नहीं मिला" text="This profile is private or does not exist." action={<LinkButton href="/members/">← सभी सदस्य</LinkButton>} />;

  const isSelf = !!user && m.user_id === user.id;
  const bd = m.birth_month && m.birth_day ? nextOccurrence(m.birth_month, m.birth_day) : null;
  const an = m.anniv_month && m.anniv_day ? nextOccurrence(m.anniv_month, m.anniv_day) : null;
  const total = (contributions.data ?? []).filter((t) => t.kind === "contribution").reduce((s, t) => s + Number(t.signed_amount), 0);

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/members/" className="mb-4 inline-flex items-center gap-1 text-sm text-leaf-700 hover:text-forest">
        <ArrowLeft className="h-4 w-4" /> सभी सदस्य · All members
      </Link>
      <Card className="overflow-hidden">
        <div className="h-28 bg-sunrise sm:h-36" />
        <div className="px-5 pb-6">
          <div className="-mt-14 flex flex-col items-center text-center sm:-mt-16 sm:flex-row sm:items-end sm:gap-5 sm:text-left">
            <Avatar name={m.full_name} src={m.photo_path ? photo[m.photo_path] : null} size={112} className="ring-4" />
            <div className="mt-3 flex-1 sm:mb-2">
              <h1 className="text-2xl font-bold text-forest">{m.full_name}</h1>
              {m.profession && <p className="text-muted">{m.profession}</p>}
              <div className="mt-1 flex flex-wrap justify-center gap-1.5 sm:justify-start">
                <Badge tone="green">#{m.member_no}</Badge>
                {m.status === "inactive" && <Badge tone="red">Inactive</Badge>}
                {isSelf && <Badge tone="gold">आप · You</Badge>}
              </div>
            </div>
            {(isSelf || isAdmin) && (
              <LinkButton href={isSelf ? "/profile/" : `/admin/?tab=members&edit=${m.id}`} variant="secondary" size="sm" icon={<Pencil className="h-4 w-4" />} className="mt-3">
                संपादित करें · Edit
              </LinkButton>
            )}
          </div>

          {m.bio && <p className="mt-5 whitespace-pre-line text-[15px] leading-relaxed text-forest-900/85">{m.bio}</p>}

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {bd && (
              <Info icon={<CakeSlice className="h-5 w-5" />} label="जन्मदिन · Birthday" value={dayMonthLabel(m.birth_day!, m.birth_month!, "hi") + (m.birth_year ? ` ${m.birth_year}` : "")} sub={relativeDays(bd.daysUntil)} />
            )}
            {an && (
              <Info icon={<Heart className="h-5 w-5" />} label="सालगिरह · Anniversary" value={dayMonthLabel(m.anniv_day!, m.anniv_month!, "hi") + (m.anniv_year ? ` ${m.anniv_year}` : "")} sub={relativeDays(an.daysUntil)} />
            )}
            {m.joining_date && <Info icon={<CalendarCheck className="h-5 w-5" />} label="जुड़े · Joined" value={formatDate(m.joining_date)} />}
            {m.phone && <Info icon={<Phone className="h-5 w-5" />} label="मोबाइल · Mobile" value={m.phone} />}
          </div>

          {m.phone && (
            <div className="mt-4 flex flex-wrap gap-2">
              <LinkButton href={`tel:${m.phone}`} external variant="secondary" icon={<Phone className="h-4 w-4" />}>कॉल · Call</LinkButton>
              <LinkButton href={`https://wa.me/91${m.phone.replace(/\D/g, "").slice(-10)}`} external variant="secondary" icon={<MessageCircle className="h-4 w-4" />}>WhatsApp</LinkButton>
            </div>
          )}
        </div>
      </Card>

      {canSeeFinance && (
        <Card className="mt-5 p-5">
          <h2 className="font-hindi text-lg font-semibold text-forest">योगदान इतिहास · Contribution history</h2>
          {contributions.loading ? <Loading /> : !contributions.data?.length ? (
            <p className="mt-2 text-sm text-muted">No contributions recorded yet.</p>
          ) : (
            <>
              <p className="mt-1 text-sm text-muted">Total contributions: <b className="text-forest">{money(total)}</b></p>
              <ul className="mt-3 divide-y divide-forest/5">
                {contributions.data.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <span className={t.is_reversed || t.is_reversal ? "text-muted line-through" : ""}>
                      {formatDate(t.txn_date)} · {t.title ?? t.kind.replace("_", " ")}
                      {t.period_month && <span className="text-muted"> ({formatDate(t.period_month, { month: "short", year: "numeric" })})</span>}
                    </span>
                    <b className={Number(t.signed_amount) < 0 ? "text-red-700" : "text-leaf-700"}>{money(t.signed_amount)}</b>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      )}
    </div>
  );
}

function Info({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-cream-100 p-3.5">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-leaf-700">{icon}</span>
      <div>
        <p className="text-xs text-muted">{label}</p>
        <p className="font-medium text-forest">{value}</p>
        {sub && <p className="text-xs text-gold-700">{sub}</p>}
      </div>
    </div>
  );
}
