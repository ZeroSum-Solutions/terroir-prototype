import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The manifest's colours have to be literals — a web manifest cannot read CSS —
 * but they must still be the colour the app actually paints. Asserting them as
 * literals here is what let them rot: they stayed on Nocturne's #F4F5F6 through
 * the Obsidian Glass retheme, and this test defended the orphan instead of
 * catching it. An installed app shows that as a grey splash and status bar.
 *
 * So derive the expectation from the token. `:root` is the first selector in
 * globals.css and holds the default (light "Bone") room; the dark overrides
 * come later under [data-theme="dark"], so the first --t-canvas is the one an
 * installed app opens on.
 */
function defaultRoomCanvas(): string {
  const css = readFileSync(resolve("src/app/globals.css"), "utf8");
  const match = css.match(/--t-canvas:\s*(#[0-9a-fA-F]{6})\s*;/);
  if (!match) throw new Error("--t-canvas is not defined in globals.css");
  return match[1].toUpperCase();
}

describe("PWA manifest contract", () => {
  it("describes the installable Terroir app and its required icons", async () => {
    const { default: manifest } = await import("../../app/manifest");
    const canvas = defaultRoomCanvas();

    expect(manifest()).toEqual({
      name: "Terroir",
      short_name: "Terroir",
      description: "Wine management for upscale restaurants.",
      start_url: "/",
      display: "standalone",
      background_color: canvas,
      theme_color: canvas,
      icons: [
        {
          src: "/icons/icon-192.png",
          sizes: "192x192",
          type: "image/png",
        },
        {
          src: "/icons/icon-512.png",
          sizes: "512x512",
          type: "image/png",
        },
        {
          src: "/icons/icon-maskable-512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "maskable",
        },
      ],
    });
  });
});
