import { Skeleton } from "@/components/skeleton";

export const runtime = "nodejs";

export default function ScansLoading() {
  return (
    <section>
      <header className="mb-lg">
        <Skeleton className="mb-md h-4 w-28" />
        <div className="flex items-end justify-between gap-md">
          <div>
            <Skeleton className="h-3 w-32" />
            <Skeleton className="mt-xs h-[42px] w-56" />
          </div>
          <Skeleton className="h-11 w-28 rounded-pill" />
        </div>
        <div className="mt-md">
          <Skeleton className="h-11 w-full rounded-pill sm:max-w-[240px]" />
        </div>
      </header>

      <div className="overflow-hidden rounded-card card-surface">
        {Array.from({ length: 8 }).map(function (_, i) {
          return (
            <div
              key={i}
              className={`flex items-start justify-between gap-md px-md py-sm ${
                i > 0 ? "border-t border-rule" : ""
              }`}
            >
              <div className="min-w-0 flex-1">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="mt-2xs h-[17px] w-40" />
              </div>
              <div className="flex flex-col items-end gap-xs">
                <Skeleton className="h-4 w-16 rounded-pill" />
                <Skeleton className="h-[17px] w-6" />
              </div>
            </div>
          );
        })}
      </div>

    </section>
  );
}
