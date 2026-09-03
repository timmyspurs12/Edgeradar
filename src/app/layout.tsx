import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { TopBar } from "@/components/TopBar";
import { APP_TZ, APP_TZ_LABEL } from "@/lib/format";

// Fonts are self-hosted (SIL OFL 1.1 — see src/app/fonts/LICENSE-*) so the
// production build never depends on a third-party fetch. `next/font/google`
// downloads at build time, which makes Vercel deploys fail whenever Google
// Fonts is slow, rate-limited or unreachable. Vendoring removes that whole
// class of deploy failure and keeps rendering byte-identical.
const archivo = localFont({
  src: "./fonts/archivo-latin-wdth-normal.woff2",
  variable: "--font-archivo",
  display: "swap",
  // Archivo Variable latin subset: wght 100–900, wdth 62%–125%.
  weight: "100 900",
  style: "normal",
  declarations: [{ prop: "font-stretch", value: "62% 125%" }],
});

const plexMono = localFont({
  src: [
    { path: "./fonts/ibm-plex-mono-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-mono-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/ibm-plex-mono-latin-600-normal.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "EdgeRadar — Pre-Match Football Intelligence",
  description:
    "Find the probabilities hiding underneath the obvious markets. Pre-match statistical prediction engine for football.",
};

export const viewport: Viewport = {
  themeColor: "#0D0F10",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${plexMono.variable}`}>
      <body className="font-sans antialiased min-h-screen bg-ink text-fg">
        <div className="flex min-h-screen">
          <Nav />
          <div className="flex-1 min-w-0 flex flex-col md:pl-52">
            <TopBar />
            <main className="flex-1 px-3 py-4 md:px-6 md:py-6 pb-24 md:pb-8 max-w-[1400px] w-full mx-auto">
              {children}
            </main>
            <footer className="px-4 md:px-6 py-4 border-t border-edge text-[11px] text-mut leading-relaxed pb-24 md:pb-4">
              EdgeRadar provides statistical probabilities, not guaranteed outcomes. Football
              remains inherently unpredictable. Past performance does not guarantee future
              results. Nothing here is betting advice. Live football data is served only by the
              provider configured via <span className="font-mono text-sec">DATA_PROVIDER</span>{" "}
              (see <span className="font-mono text-sec">/sources</span>) — demo and live data are
              never mixed. Kickoff times are shown in {APP_TZ_LABEL} ({APP_TZ}).
            </footer>
          </div>
        </div>
      </body>
    </html>
  );
}
