import { BookOpenText, ChartNoAxesColumnIncreasing, House, RotateCcw, Route, UserRound, type LucideIcon } from "lucide-react";

export type NavItem = { href: string; label: string; icon: LucideIcon; match: (path: string) => boolean };

export const PRIMARY_NAV: NavItem[] = [
  { href: "/dashboard", label: "الرئيسية", icon: House, match: (p) => p === "/dashboard" },
  {
    href: "/curriculum",
    label: "المسار العلمي",
    icon: Route,
    match: (p) => p.startsWith("/curriculum") || p.startsWith("/lessons"),
  },
  { href: "/memorize", label: "احفظ", icon: BookOpenText, match: (p) => p.startsWith("/memorize") },
  { href: "/progress", label: "تقدمي", icon: ChartNoAxesColumnIncreasing, match: (p) => p.startsWith("/progress") },
  { href: "/review", label: "المراجعة", icon: RotateCcw, match: (p) => p.startsWith("/review") },
];

export const ACCOUNT_NAV: NavItem = {
  href: "/account",
  label: "الحساب",
  icon: UserRound,
  match: (p) => p.startsWith("/account"),
};

