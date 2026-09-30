import type { Metadata, Viewport } from "next";
import BottomNav from "@/components/BottomNav";
import SideNav from "@/components/SideNav";
import WaBanner from "@/components/WaBanner";
import { isLoggedIn } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getSetting } from "@/lib/services/settings";
import { logout } from "./actions";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "DompetKos", template: "%s · DompetKos" },
  description: "Budget mingguan sistem amplop + bot WhatsApp",
  robots: { index: false, follow: false },
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "DompetKos", statusBarStyle: "default" },
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
  if (!login) {
    return (
      <html lang="id">
        <body className="min-h-dvh">{children}</body>
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
            <main id="konten" className="mx-auto w-full max-w-5xl px-4 pb-28 pt-5 sm:px-6 lg:px-10 lg:pb-12 lg:pt-8">
              {children}
            </main>
          </div>
        </div>
        <BottomNav />
      </body>
    </html>
  );
}
