import { Skeleton, SkeletonText } from "@/components/ui/skeleton";

/** Calm placeholder with the same silhouette as the home, so nothing jumps when data arrives. */
export default function DashboardLoading() {
  return (
    <div aria-busy className="mx-auto max-w-4xl space-y-8 sm:space-y-10" role="status">
      <span className="sr-only">جارٍ تحميل رحلتك…</span>
      <div>
        <Skeleton className="h-4 w-36" />
        <Skeleton className="mt-3 h-8 w-64 max-w-full" />
      </div>
      <Skeleton className="h-64 rounded-2xl sm:h-72" />
      <div className="rounded-xl border border-line bg-surface p-6">
        <Skeleton className="h-5 w-28" />
        <div className="mt-6 grid gap-8 md:grid-cols-2">
          <SkeletonText lines={3} />
          <SkeletonText lines={3} />
        </div>
      </div>
      <Skeleton className="h-40 rounded-xl" />
    </div>
  );
}
