import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { TopBar } from "@/components/TopBar";

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
    <html lang="en">
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
              results. Nothing here is betting advice. Live data is fetched through the active provider
              abstraction layer (API-Football / football-data.org). Kickoff times are shown in Africa/Lagos (WAT).
            </footer>
          </div>
        </div>
      </body>
    </html>
  );
}
