import type { Metadata } from "next";
import { requireAdminPage } from "@/server/auth/current-user";
import { AdminShell } from "@/components/admin/admin-shell";

export const metadata: Metadata = {
  title: { default: "لوحة الإدارة", template: "%s · لوحة إدارة تفقّه" },
  robots: { index: false, follow: false },
};

/**
 * Every /admin/* route renders inside this layout and nothing from the student shell.
 * The role check here is only the first gate: each page, action and API route re-checks ADMIN.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdminPage();
  return <AdminShell admin={{ name: admin.name }}>{children}</AdminShell>;
}
