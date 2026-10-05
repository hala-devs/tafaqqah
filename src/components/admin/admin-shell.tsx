"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { LogOut, Menu, ShieldCheck, X } from "lucide-react";
import { logoutAction } from "@/app/(auth)/actions";
import { Logo } from "@/components/shell/logo";
import { cn } from "@/lib/cn";
import { ADMIN_NAV } from "./admin-nav";

function NavLinks({ path, onNavigate }: { path: string; onNavigate?: () => void }) {
  return (
    <nav aria-label="أقسام لوحة الإدارة" className="flex flex-col gap-0.5">
      {ADMIN_NAV.map((item) => {
        const active = item.match(path);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-small transition-colors duration-150",
              active ? "bg-white/12 font-medium text-white" : "text-white/70 hover:bg-white/8 hover:text-white",
            )}
          >
            <Icon className={cn("size-[1.1rem] shrink-0", active ? "text-gold" : "text-white/50")} aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function Brand() {
  return (
    <Logo href="/admin" imageClassName="w-24" ariaLabel="تفقّه — لوحة الإدارة" />
  );
}

/** The admin chrome: fixed sidebar (lg+), top bar with the signed-in admin, and a drawer on small screens. */
export function AdminShell({ admin, children }: { admin: { name: string }; children: React.ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-dvh bg-paper" data-area="admin">
      <aside className="fixed inset-y-0 start-0 z-30 hidden w-64 flex-col overflow-y-auto bg-ink-dark px-3 py-5 lg:flex">
        <div className="px-3 pb-6">
          <Brand />
          <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-gold/15 px-2.5 py-0.5 text-caption font-medium text-gold">
            <ShieldCheck className="size-3.5" aria-hidden />
            لوحة الإدارة
          </p>
        </div>
        <NavLinks path={path} />
      </aside>

      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="قائمة لوحة الإدارة">
          <button type="button" aria-label="إغلاق القائمة" className="absolute inset-0 bg-ink-dark/50" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 start-0 flex w-72 max-w-[85vw] flex-col overflow-y-auto bg-ink-dark px-3 py-5">
            <div className="flex items-center justify-between px-3 pb-5">
              <Brand />
              <button type="button" onClick={() => setOpen(false)} aria-label="إغلاق" className="rounded-md p-1.5 text-white/70 hover:bg-white/10">
                <X className="size-5" aria-hidden />
              </button>
            </div>
            <NavLinks path={path} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      ) : null}

      <div className="lg:ps-64">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-surface/95 px-4 backdrop-blur-md sm:px-6 lg:px-10">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="فتح قائمة الإدارة"
            className="rounded-md p-2 text-ink hover:bg-surface-2 lg:hidden"
          >
            <Menu className="size-5" aria-hidden />
          </button>
          <div className="flex items-center gap-2 text-small text-ink">
            <Logo href="/admin" imageClassName="w-16" ariaLabel="تفقّه — لوحة الإدارة" />
            <span aria-hidden className="h-4 w-px bg-line-strong" />
            <span className="text-muted">لوحة الإدارة</span>
          </div>
          <div className="ms-auto flex items-center gap-3">
            <span className="hidden max-w-48 truncate text-small text-ink sm:inline" data-testid="admin-account">
              {admin.name}
            </span>
            <span className="hidden rounded-full border border-line px-2 py-0.5 text-caption text-muted sm:inline">مدير</span>
            <form action={logoutAction}>
              <button type="submit" className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-small text-muted transition-colors hover:bg-surface-2 hover:text-ink">
                <LogOut className="size-4" aria-hidden />
                <span className="sr-only sm:not-sr-only">تسجيل الخروج</span>
              </button>
            </form>
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-10">
          {children}
        </main>
      </div>
    </div>
  );
}
