import { Skeleton } from "@/components/skeleton";

export default function AtlasLoading() {
  return (
    <section>
      <div className="dawn-gradient -mx-md -mt-lg px-md pb-lg pt-lg md:-mx-lg md:-mt-xl md:px-lg md:pb-2xl md:pt-xl">
        <Skeleton className="mb-xs h-[11px] w-32" />
        <Skeleton className="h-[44px] w-64" />
      </div>
      <div className="px-md py-md md:px-lg">
        <Skeleton className="aspect-[960/500] w-full rounded-lg" />
      </div>
    </section>
  );
}
