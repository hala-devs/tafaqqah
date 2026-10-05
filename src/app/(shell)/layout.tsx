import { MobileNav, Sidebar } from "@/components/shell/app-nav";
import { requireLearner } from "@/server/auth/current-user";

export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const user = await requireLearner();
  const navUser = { name: user.name, role: user.role };

  return (
    <div className="min-h-dvh">
      <Sidebar user={navUser} />
      <MobileNav user={navUser} />
      <div className="lg:ps-68">
        <main id="main" className="mx-auto w-full max-w-6xl px-4 pt-6 pb-28 sm:px-6 lg:px-10 lg:pt-10 lg:pb-16">
          {children}
        </main>
      </div>
    </div>
  );
}
