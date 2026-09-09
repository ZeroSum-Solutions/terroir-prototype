import { Skeleton } from "@/components/skeleton";

export default function InsightsLoading() {
  return (
    <div className="space-y-xl">
      <div className="dawn-gradient -mx-md -mt-lg px-md pb-lg pt-lg md:-mx-lg md:-mt-xl md:px-lg md:pb-2xl md:pt-xl">
        <Skeleton className="mb-sm h-[12px] w-40" />
        <Skeleton className="h-[44px] w-64" />
      </div>
      {/* One glass strip, four cells — the shape the loaded page resolves to. */}
      <div className="glass grid grid-cols-2 overflow-hidden rounded-card md:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="p-md">
            <Skeleton className="mb-sm h-[12px] w-20" />
            <Skeleton className="h-[28px] w-16" />
          </div>
        ))}
      </div>
      <Skeleton className="h-[52px] w-[280px] max-w-full rounded-pill" />
      <div className="glass rounded-card p-lg">
        <Skeleton className="mb-md h-[12px] w-36" />
        <Skeleton className="h-[120px] w-full" />
      </div>
      {Array.from({ length: 2 }, (_, i) => (
        <div key={i} className="glass rounded-card p-lg">
          <Skeleton className="mb-md h-[12px] w-40" />
          {Array.from({ length: 5 }, (_, j) => (
            <div key={j} className="flex justify-between border-b border-rule py-sm">
              <Skeleton className="h-[13px] w-32" />
              <Skeleton className="h-[13px] w-16" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
