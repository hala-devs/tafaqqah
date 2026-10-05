"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const TABS = [
  { href: "/admin/ai", label: "نظرة عامة", match: (p: string) => p === "/admin/ai" },
  { href: "/admin/logs", label: "سجل الأسئلة والتتبّع", match: (p: string) => p.startsWith("/admin/logs") || p.startsWith("/admin/questions") },
  { href: "/admin/evaluation", label: "التقييم والمقارنة", match: (p: string) => p.startsWith("/admin/evaluation") },
];

/** Sub-navigation shared by the AI / assessments pages. */
export function AiSubNav() {
  const path = usePathname();
  return (
    <nav aria-label="أقسام الاختبارات والذكاء الاصطناعي" className="mb-6 flex gap-1 overflow-x-auto border-b border-line">
      {TABS.map((tab) => {
        const active = tab.match(path);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn("-mb-px shrink-0 border-b-2 px-4 py-2.5 text-small transition-colors duration-150", active ? "border-ink font-medium text-ink" : "border-transparent text-muted hover:text-ink")}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
