"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./icons";
import { BOTTOM_NAV, NAV_GROUPS, isActive } from "./nav-items";

export default function BottomNav() {
  const path = usePathname();
  const diMenuLain = !BOTTOM_NAV.slice(0, 4).some((i) => isActive(path, i.href)) && NAV_GROUPS.some((g) => g.items.some((i) => isActive(path, i.href)));
  return (
    <nav aria-label="Navigasi utama" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
      <ul className="mx-auto grid max-w-lg grid-cols-5">
        {BOTTOM_NAV.map((it) => {
          const aktif = it.href === "/menu" ? diMenuLain || path === "/menu" : isActive(path, it.href);
          if (it.href === "/catat") {
            return (
              <li key={it.href} className="flex justify-center">
                <Link href={it.href} aria-label="Catat pengeluaran" className="-mt-5 flex size-14 items-center justify-center rounded-2xl bg-brand text-brand-fg shadow-lg shadow-[var(--ring)] transition active:scale-95">
                  <Icon name="plus" size={26} strokeWidth={2.2} />
                </Link>
              </li>
            );
          }
          return (
            <li key={it.href}>
              <Link
                href={it.href}
                aria-current={aktif ? "page" : undefined}
                className={`flex min-h-14 flex-col items-center justify-center gap-1 text-[11px] font-medium ${aktif ? "text-brand" : "text-muted"}`}
              >
                <Icon name={it.icon} size={21} />
                {it.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
