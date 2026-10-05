import {
  BookOpenCheck,
  BookOpenText,
  BrainCircuit,
  ClipboardCheck,
  GraduationCap,
  History,
  LayoutDashboard,
  LibraryBig,
  LineChart,
  Route,
  Settings,
  type LucideIcon,
} from "lucide-react";

export type AdminNavItem = { href: string; label: string; icon: LucideIcon; match: (path: string) => boolean };

const under = (prefix: string) => (path: string) => path === prefix || path.startsWith(`${prefix}/`);

/** Admin-only navigation. Nothing here is shared with the student app navigation. */
export const ADMIN_NAV: AdminNavItem[] = [
  { href: "/admin", label: "الرئيسية", icon: LayoutDashboard, match: (p) => p === "/admin" },
  { href: "/admin/curriculum", label: "المسار العلمي", icon: Route, match: under("/admin/curriculum") },
  { href: "/admin/lessons", label: "الدروس", icon: BookOpenCheck, match: under("/admin/lessons") },
  { href: "/admin/matn", label: "حفظ المتن", icon: BookOpenText, match: under("/admin/matn") },
  { href: "/admin/sources", label: "المحتوى والمصادر", icon: LibraryBig, match: under("/admin/sources") },
  { href: "/admin/review", label: "مراجعة المحتوى", icon: ClipboardCheck, match: under("/admin/review") },
  {
    href: "/admin/ai",
    label: "الاختبارات والذكاء الاصطناعي",
    icon: BrainCircuit,
    match: (p) => ["/admin/ai", "/admin/logs", "/admin/questions", "/admin/evaluation"].some((prefix) => under(prefix)(p)),
  },
  { href: "/admin/students", label: "الطلاب", icon: GraduationCap, match: under("/admin/students") },
  { href: "/admin/analytics", label: "التحليلات", icon: LineChart, match: under("/admin/analytics") },
  { href: "/admin/audit", label: "سجل العمليات", icon: History, match: under("/admin/audit") },
  { href: "/admin/settings", label: "الإعدادات", icon: Settings, match: under("/admin/settings") },
];
