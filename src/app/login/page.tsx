import { redirect } from "next/navigation";
import { isLoggedIn } from "@/lib/auth/session";
import LoginForm from "./LoginForm";

export default async function LoginPage() {
  if (await isLoggedIn()) redirect("/");
  return (
    <main className="mx-auto mt-20 max-w-sm">
      <h1 className="text-2xl font-bold">DompetKos</h1>
      <p className="mb-6 mt-1 text-sm text-muted">Masuk buat lihat amplop mingguan lo.</p>
      <LoginForm />
    </main>
  );
}
