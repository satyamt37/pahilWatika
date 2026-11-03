"use client";
import Link from "next/link";
import { MORE_LINKS } from "@/components/AppShell";
import { PageHeader } from "@/components/ui";
import { useAuth } from "@/lib/auth";

export default function MorePage() {
  const { isAdmin, isTreasurer } = useAuth();
  const links = MORE_LINKS.filter((l) => !("admin" in l && l.admin) || isAdmin || isTreasurer);
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader hi="और" en="More" />
      <div className="grid grid-cols-2 gap-3">
        {links.map(({ href, hi, en, icon: Icon }) => (
          <Link key={href} href={href} className="flex flex-col items-center gap-2 rounded-2xl bg-white p-5 text-center shadow-card">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-leaf-50 text-leaf-700"><Icon className="h-6 w-6" /></span>
            <span className="font-hindi font-medium text-forest">{hi}</span>
            <span className="text-xs text-muted">{en}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
