import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Manrope, Source_Code_Pro } from "next/font/google";
import "./globals.css";

/**
 * Obsidian Glass's three faces (DESIGN.md — Typography). Cormorant Garamond
 * is the named face — wine names, producers, headlines, the wordmark — with
 * the italic carrying the one emphasised word in a headline. Manrope is the
 * working face for everything you operate. Source Code Pro is unchanged,
 * for bin codes only.
 */
const cormorant = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  display: "swap",
});

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  display: "swap",
});

const sourceCode = Source_Code_Pro({
  variable: "--font-source-code",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    template: "%s · Terroir",
    default: "Terroir",
  },
  description: "Wine management for upscale restaurants.",
  appleWebApp: {
    capable: true,
    title: "Terroir",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0B0B0C" },
    { media: "(prefers-color-scheme: light)", color: "#F1EADB" },
  ],
  viewportFit: "cover",
};

/**
 * Applies the stored theme choice before first paint so neither room
 * flashes. "light" | "dark" set data-theme explicitly; "system" leaves the
 * device preference in charge via the prefers-color-scheme blocks in
 * globals.css; NO stored choice means Obsidian — the dark room is the
 * brand's first face (DESIGN.md — Theme), so a first visit lands there
 * whatever the device says. The public guest list (/list/…) is the one
 * exception: it is the venue's artefact, read at a table, and DESIGN.md
 * names Bone as the guest-menu room — so it is always light, and a venue's
 * own brand theme paints over that. An explicit choice also overrides both
 * theme-color metas so browser/PWA chrome matches the page (ThemeToggle
 * keeps them in sync on later changes; hexes hand-synced with
 * viewport.themeColor).
 */
const themeInitScript = `try{var t=localStorage.getItem("terroir-theme");if(t!=="light"&&t!=="dark"&&t!=="system"){t="dark"}if(location.pathname.indexOf("/list/")===0){t="light"}if(t==="light"||t==="dark"){document.documentElement.dataset.theme=t;var c=t==="dark"?"#0B0B0C":"#F1EADB";document.querySelectorAll('meta[name="theme-color"]').forEach(function(m){m.setAttribute("content",c)})}}catch(e){}`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${manrope.variable} ${cormorant.variable} ${sourceCode.variable} h-full overflow-x-clip`}
      suppressHydrationWarning
    >
      <body className="min-h-full">
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        {children}
      </body>
    </html>
  );
}
