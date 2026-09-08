# Reference bottle photos

The prototype can display a sourced photograph of the same producer and cuvée
when its vintage, bottle size or disgorgement differs from the cellar entry.
The detail page and drawer show this caption:

> Reference bottle photo. Vintage, bottle size and disgorgement may differ.

Thumbnails preserve the full bottle with `object-contain` and include the caption
in their alternative text and title. Small thumbnails cannot make fine label text
readable; open the wine to inspect its larger photograph.

## Storage and replacement

The caption resolver in `src/lib/wine-intelligence/wine-image-reference.ts`
recognizes HTTP or HTTPS public URLs in the `wine-images` storage bucket. The
object key consists of a tenant UUID, the literal directory `reference-photos`,
a wine UUID, and a SHA-256 filename with a jpg, png or webp extension.
The wine row points to that object through `hero_image_url`.

Replacing the URL with an ordinary user upload removes the reference caption.
Unlinking or replacing a reference does not delete its archived source object;
retain the acquisition manifest when managing those objects. This feature changes
no schema, access policy or upload endpoint.

## Acquisition records

Keep the original source image bytes, SHA-256 digest, source page and image URL,
image dimensions, visible label details and review outcome with each selection.
Distinguish manual visual checks from automated selections and independent model
checks. A matching search title alone does not identify the bottle.

Use a photograph only when its producer and cuvée match. Leave unresolved wines
flagged for further sourcing. A blank CSV volume stays unknown, and an unreadable
year stays unknown. Record source reuse permission separately from image identity;
an accurate match does not establish permission.

## Verification scope

The local pilot passed image-loading, caption and uncropped-bottle checks on detail,
drawer and thumbnail views at 320, 768 and 1200 pixels. Resolver tests cover ordinary
replacement URLs and malformed reference paths. These checks establish display
behavior; each acquired photograph still needs its own identity review. They do
not establish hosted deployment, hosted data loading or live storage-policy coverage.
