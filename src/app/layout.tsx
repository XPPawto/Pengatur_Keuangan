import type { Metadata, Viewport } from "next";
import Nav from "@/components/Nav";
import WaBanner from "@/components/WaBanner";
import { isLoggedIn } from "@/lib/auth/session";
import "./globals.css";

export const metadata: Metadata = {
  title: "DompetKos",
  description: "Budget mingguan sistem amplop + bot WhatsApp",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f6f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1117" },
  ],
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const login = await isLoggedIn();
  return (
    <html lang="id">
      <body className="min-h-dvh">
        {login && <WaBanner />}
        {login && <Nav />}
        <div className="mx-auto max-w-2xl px-4 pb-24 pt-4 sm:pb-8">{children}</div>
      </body>
    </html>
  );
}
