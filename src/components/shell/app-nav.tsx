"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
import { logoutAction } from "@/app/(auth)/actions";
import { cn } from "@/lib/cn";
import { Logo } from "./logo";
import { ACCOUNT_NAV, PRIMARY_NAV, type NavItem } from "./nav-items";

type NavUser = { name: string; role: "STUDENT" | "ADMIN" };

function SidebarLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex items-center gap-3 rounded-lg px-3.5 py-2.5 text-body transition-colors duration-200 ease-calm",
        active ? "bg-surface text-ink font-medium shadow-soft" : "text-muted hover:bg-surface/70 hover:text-ink",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-2 start-0 w-0.5 rounded-full bg-sage-dark transition-opacity duration-200",
          active ? "opacity-100" : "opacity-0",
        )}
      />
      <Icon className={cn("size-[1.15rem]", active ? "text-sage-dark" : "text-faint group-hover:text-ink")} aria-hidden />
      {item.label}
    </Link>
  );
}

/** Desktop RTL sidebar (≥ lg). */
export function Sidebar({ user }: { user: NavUser }) {
  const path = usePathname();
  return (
    <aside className="fixed inset-y-0 start-0 z-30 hidden w-68 flex-col border-e border-line bg-surface-2/60 px-4 py-6 lg:flex">
      <div className="px-2">
        <Logo href="/dashboard" />
      </div>

      <nav aria-label="التنقل الرئيسي" className="mt-10 flex flex-col gap-1">
        {PRIMARY_NAV.map((item) => (
          <SidebarLink key={item.href} item={item} active={item.match(path)} />
        ))}
      </nav>

      <div className="mt-auto space-y-1 border-t border-line pt-4">
        <SidebarLink item={ACCOUNT_NAV} active={ACCOUNT_NAV.match(path)} />
        <form action={logoutAction}>
          <button
            type="submit"
            className="flex w-full items-center gap-3 rounded-lg px-3.5 py-2.5 text-body text-muted transition-colors duration-200 hover:bg-surface/70 hover:text-ink"
          >
            <LogOut className="size-[1.15rem] text-faint" aria-hidden />
            تسجيل الخروج
          </button>
        </form>
        <p className="truncate px-3.5 pt-3 text-caption text-faint">{user.name}</p>
      </div>
    </aside>
  );
}

/** Mobile/tablet top bar + bottom tab bar (< lg). */
export function MobileNav({ user }: { user: NavUser }) {
  const path = usePathname();
  const AccountIcon = ACCOUNT_NAV.icon;
  return (
    <>
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-line bg-paper/90 px-4 backdrop-blur-md lg:hidden">
        <Logo href="/dashboard" />
        <Link
          href={ACCOUNT_NAV.href}
          aria-label={`الحساب — ${user.name}`}
          className={cn(
            "flex size-10 items-center justify-center rounded-full border border-line bg-surface text-ink",
            ACCOUNT_NAV.match(path) && "border-sage-dark text-sage-dark",
          )}
        >
          <AccountIcon className="size-5" aria-hidden />
        </Link>
      </header>

      <nav
        aria-label="التنقل الرئيسي"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
      >
        <ul className="mx-auto grid max-w-lg grid-cols-5">
          {PRIMARY_NAV.map((item) => {
            const active = item.match(path);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-16 flex-col items-center justify-center gap-1 text-micro transition-colors duration-200",
                    active ? "text-ink font-medium" : "text-muted",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-7 w-12 items-center justify-center rounded-full transition-colors duration-200",
                      active && "bg-sage-soft",
                    )}
                  >
                    <Icon className={cn("size-5", active ? "text-sage-dark" : "text-faint")} aria-hidden />
                  </span>
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
