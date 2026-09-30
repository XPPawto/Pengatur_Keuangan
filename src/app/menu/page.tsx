import Link from "next/link";
import { Icon } from "@/components/icons";
import { NAV_GROUPS } from "@/components/nav-items";
import { PageHeader } from "@/components/ui";
import { logout } from "../actions";

export const metadata = { title: "Menu" };

export default function MenuPage() {
  return (
    <div className="space-y-5">
      <PageHeader title="Menu" />
      {NAV_GROUPS.map((g) => (
        <section key={g.judul}>
          <h2 className="section-title mb-2">{g.judul}</h2>
          <ul className="card divide-y divide-line overflow-hidden">
            {g.items.map((it) => (
              <li key={it.href}>
                <Link href={it.href} className="flex items-center gap-3 px-4 py-3.5 transition hover:bg-subtle">
                  <span className="flex size-10 items-center justify-center rounded-xl bg-brand-soft text-brand">
                    <Icon name={it.icon} size={19} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{it.label}</span>
                    <span className="block truncate text-xs text-muted">{it.deskripsi}</span>
                  </span>
                  <Icon name="chevron-right" size={18} className="text-muted" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <form action={logout}>
        <button className="btn-secondary w-full">
          <Icon name="logout" size={18} />
          Keluar
        </button>
      </form>
    </div>
  );
}
