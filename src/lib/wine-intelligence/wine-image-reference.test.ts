import { describe, expect, it } from "vitest";
import { wineImageReferenceNote } from "./wine-image-reference";

const TENANT = "aeb8a259-7dd8-43d7-acbc-c45ccd540888";
const WINE = "00212d1a-7457-4a34-8529-993c93a77d50";
const PATH = `/storage/v1/object/public/wine-images/${TENANT}/reference-photos/${WINE}/${"a".repeat(64)}.jpg`;

describe("wineImageReferenceNote", () => {
  it("discloses reference uncertainty in local and hosted storage", () => {
    for (const base of ["http://127.0.0.1:57321", "https://example.supabase.co"]) {
      expect(wineImageReferenceNote(`${base}${PATH}`))
        .toBe("Reference bottle photo. Vintage, bottle size and disgorgement may differ.");
    }
  });
  it("does not transfer a caption to a replacement user photo", () => {
    expect(wineImageReferenceNote(`https://example.test/storage/v1/object/public/wine-images/${TENANT}/${WINE}.jpg`)).toBeNull();
    expect(wineImageReferenceNote(null)).toBeNull();
  });
  it("does not classify a query string, partial path or unrelated image as a reference", () => {
    for (const url of ["https://example.test/upload.jpg?reference-photos=yes", "https://example.test/reference-photos/wine.jpg", `https://example.test${PATH}/extra`, "not a url", `ftp://example.test${PATH}`]) {
      expect(wineImageReferenceNote(url)).toBeNull();
    }
  });
});
