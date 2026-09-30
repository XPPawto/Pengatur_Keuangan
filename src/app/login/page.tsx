import { redirect } from "next/navigation";
import { Logo } from "@/components/icons";
import { isLoggedIn } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getSetting } from "@/lib/services/settings";
import LoginForm from "./LoginForm";

export const metadata = { title: "Masuk" };

export default async function LoginPage() {
  if (await isLoggedIn()) redirect("/");
  const otp = (await getSetting(prisma, "otp_login").catch(() => "0")) === "1";
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <Logo size={48} />
          <h1 className="mt-4 text-2xl font-bold tracking-tight">Masuk ke DompetKos</h1>
          <p className="mt-1 text-sm text-muted">Budget mingguan sistem amplop</p>
        </div>
        <LoginForm otp={otp} />
        <p className="mt-6 text-center text-xs text-muted">Data keuangan pribadi. Hanya pemilik yang bisa masuk.</p>
      </div>
    </main>
  );
}
