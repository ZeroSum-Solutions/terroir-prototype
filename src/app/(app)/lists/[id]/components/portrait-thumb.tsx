import { WineThumb, type WineThumbProps } from "@/components/wine-thumb";

/**
 * A 2:3 portrait plate for a wine-list row or result (DESIGN.md — Index Row):
 * the bottle stands in a rounded-lg well with a glass hairline, which is what
 * makes a column of rows read as an index rather than as a list of chips.
 * `WineThumb` itself stays square and untouched — this only frames it.
 */
export function PortraitThumb({
  width,
  ...thumb
}: Omit<WineThumbProps, "size" | "className"> & { width: number }) {
  return (
    <div
      className="grid shrink-0 place-items-center overflow-hidden rounded-lg border border-glass-edge bg-surface-sunken"
      style={{ width, height: Math.round(width * 1.5) }}
    >
      <WineThumb {...thumb} size={width} />
    </div>
  );
}
