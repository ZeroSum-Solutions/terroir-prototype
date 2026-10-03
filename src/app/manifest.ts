import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Terroir",
    short_name: "Terroir",
    description: "Wine management for upscale restaurants.",
    start_url: "/",
    display: "standalone",
    // Bone — the default room's canvas (--t-canvas in globals.css). A manifest
    // cannot read CSS, so these are literals; pwa-manifest.test.ts holds them
    // to the token so a retheme cannot orphan them again. It has once: these
    // stayed on Nocturne's #F4F5F6 through the Obsidian Glass retheme, which
    // an installed app shows as a grey splash and status bar.
    background_color: "#F1EADB",
    theme_color: "#F1EADB",
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
  };
}
