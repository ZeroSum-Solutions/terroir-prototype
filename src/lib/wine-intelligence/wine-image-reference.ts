/**
 * Curated reference photos use a separate storage prefix. Replacing a
 * reference with an ordinary user upload automatically removes its caption.
 */
export function wineImageReferenceNote(
  imageUrl: string | null | undefined,
): string | null {
  if (!imageUrl) return null;
  try {
    const url = new URL(imageUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
    const path = new RegExp(`^/storage/v1/object/public/wine-images/${uuid}/reference-photos/${uuid}/[0-9a-f]{64}\\.(jpg|png|webp)$`);
    if (!path.test(url.pathname)) return null;
    return "Reference bottle photo. Vintage, bottle size and disgorgement may differ.";
  } catch {
    return null;
  }
}
