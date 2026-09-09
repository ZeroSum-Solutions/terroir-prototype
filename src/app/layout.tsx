import type { Metadata, Viewport } from "next";
import { Archivo, Inter, Source_Code_Pro } from "next/font/google";
import "./globals.css";

/**
 * Cellar Index's three faces (DESIGN.md — Typography). Archivo is a heavy,
 * tight-tracked grotesque for display, headings and wine names — the
 * opposite call from Nocturne, which retired Archivo in favour of a serif
 * superfamily for a dark-cellar-at-night concept. Inter is the safest
 * well-hinted grotesque at 13-14px on a phone screen for everything you
 * operate. Source Code Pro is unchanged, for bin codes only. There is no
 * signature face — Ephesis is dropped outright, not replaced.
 */
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  display: "swap",
});

const inter = Inter({
  variable: "--font-inter",
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
    { media: "(prefers-color-scheme: dark)", color: "#121212" },
    { media: "(prefers-color-scheme: light)", color: "#F8F7EF" },
  ],
  viewportFit: "cover",
};

/**
 * Applies the stored theme choice before first paint so neither mode
 * flashes. "light" | "dark" set data-theme explicitly; anything else
 * (or no storage access) leaves the system preference in charge via
 * the prefers-color-scheme blocks in globals.css. An explicit choice
 * also overrides both theme-color metas so browser/PWA chrome matches
 * the page rather than the system scheme (ThemeToggle keeps them in
 * sync on later changes; hexes hand-synced with viewport.themeColor).
 */
const themeInitScript = `try{var t=localStorage.getItem("terroir-theme");if(t==="light"||t==="dark"){document.documentElement.dataset.theme=t;var c=t==="dark"?"#121212":"#F8F7EF";document.querySelectorAll('meta[name="theme-color"]').forEach(function(m){m.setAttribute("content",c)})}}catch(e){}`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${archivo.variable} ${sourceCode.variable} h-full overflow-x-clip`}
      suppressHydrationWarning
    >
      <body className="min-h-full">
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        {children}
      </body>
    </html>
  );
}
