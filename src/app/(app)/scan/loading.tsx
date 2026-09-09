import { Skeleton } from "@/components/skeleton";

export default function ScanLoading() {
  return (
    <section>
      <header className="mb-lg">
        <Skeleton className="mb-xs h-3 w-24" />
        <Skeleton className="h-[42px] w-64 mb-sm" />
        <Skeleton className="h-[15px] w-72" />
      </header>
      <div className="mb-lg flex items-center justify-center">
        <Skeleton className="h-12 w-48 rounded-pill" />
      </div>
      <div className="rounded-card bg-surface-sunken p-xl">
        <div className="flex flex-col items-center gap-md">
          <Skeleton className="h-14 w-14 rounded-full" />
          <Skeleton className="h-[20px] w-40" />
          <Skeleton className="h-[13px] w-48" />
        </div>
      </div>
      <div className="mt-md grid grid-cols-2 gap-sm">
        <Skeleton className="h-12 rounded-pill" />
        <Skeleton className="h-12 rounded-pill" />
      </div>
      <div className="mt-2xl">
        <div className="mb-md flex items-center justify-between">
          <Skeleton className="h-[14px] w-24" />
          <Skeleton className="h-[14px] w-14" />
        </div>
        <div className="overflow-hidden rounded-card card-surface">
          {Array.from({ length: 3 }, (_, i) => (
            <div
              key={i}
              className={`px-md py-sm ${i > 0 ? "border-t border-rule" : ""}`}
            >
              <Skeleton className="mb-xs h-[12px] w-16" />
              <Skeleton className="h-[17px] w-32" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
