import type { Metadata, Viewport } from "next";
import BottomNav from "@/components/BottomNav";
import SideNav from "@/components/SideNav";
import WaBanner from "@/components/WaBanner";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isLoggedIn } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getSetting } from "@/lib/services/settings";
import { logout } from "./actions";
import Pwa from "@/components/Pwa";
import { LAYAR_IPHONE } from "@/lib/pwa/layar";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "DompetKos", template: "%s · DompetKos" },
  description: "Budget mingguan sistem amplop + bot WhatsApp",
  robots: { index: false, follow: false },
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "DompetKos",
    statusBarStyle: "default",
    // layar pembuka iPhone (terang & gelap), termasuk iPhone 13 (390×844 @3x)
    startupImage: LAYAR_IPHONE.flatMap(({ w, h, s }) =>
      (["terang", "gelap"] as const).map((tema) => ({
        url: `/splash?w=${w * s}&h=${h * s}${tema === "gelap" ? "&tema=gelap" : ""}`,
        media: `(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${s}) and (orientation: portrait) and (prefers-color-scheme: ${tema === "gelap" ? "dark" : "light"})`,
      })),
    ),
  },
  formatDetection: { telephone: false, email: false, address: false },
  applicationName: "DompetKos",
  // iOS lama hanya mengenal nama meta lama ini untuk mode aplikasi layar penuh & layar pembuka
  other: { "apple-mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f7f9" },
    { media: "(prefers-color-scheme: dark)", color: "#0c1117" },
  ],
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const login = await isLoggedIn();
  // tanda tangan cookie sah tapi sesinya sudah dicabut ("Keluar dari semua perangkat") → wajib login ulang
  if (!login && (await headers()).get("x-dk-dilindungi") === "1") redirect("/login");
  if (!login) {
    return (
      <html lang="id">
        <body className="min-h-dvh">
          {children}
          <Pwa />
        </body>
      </html>
    );
  }
  const nama = await getSetting(prisma, "nama_pengguna").catch(() => "Abdul");
  return (
    <html lang="id">
      <body className="min-h-dvh">
        <a href="#konten" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-card focus:px-3 focus:py-2">
          Lewati ke konten
        </a>
        <div className="flex min-h-dvh">
          <SideNav nama={nama} logoutAction={logout} />
          <div className="min-w-0 flex-1">
            <WaBanner />
            <main id="konten" className="mx-auto w-full max-w-5xl px-4 pb-[calc(6.5rem+env(safe-area-inset-bottom))] pt-5 sm:px-6 lg:px-10 lg:pb-12 lg:pt-8">
              {children}
            </main>
          </div>
        </div>
        <BottomNav />
        <Pwa />
      </body>
    </html>
  );
}
