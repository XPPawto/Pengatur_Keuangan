"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, Logo } from "./icons";
import { NAV_GROUPS, isActive } from "./nav-items";

export default function SideNav({ nama, logoutAction }: { nama: string; logoutAction: () => Promise<void> }) {
  const path = usePathname();
  return (
    <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-line bg-card lg:flex">
      <div className="flex items-center gap-3 px-5 py-5">
        <Logo />
        <div>
          <p className="text-[15px] font-bold leading-tight">DompetKos</p>
          <p className="text-xs text-muted">Budget mingguan {nama}</p>
        </div>
      </div>
      <nav aria-label="Navigasi utama" className="flex-1 overflow-y-auto px-3 pb-4">
        {NAV_GROUPS.map((g) => (
          <div key={g.judul} className="mb-4">
            <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">{g.judul}</p>
            <ul className="space-y-0.5">
              {g.items.map((it) => {
                const aktif = isActive(path, it.href);
                return (
                  <li key={it.href}>
                    <Link
                      href={it.href}
                      aria-current={aktif ? "page" : undefined}
                      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                        aktif ? "bg-brand-soft text-brand" : "text-fg-2 hover:bg-subtle hover:text-fg"
                      }`}
                    >
                      <Icon name={it.icon} size={18} />
                      {it.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <form action={logoutAction} className="border-t border-line p-3">
        <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-fg-2 hover:bg-subtle">
          <Icon name="logout" size={18} />
          Keluar
        </button>
      </form>
    </aside>
  );
}
