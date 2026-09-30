"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "Beranda", icon: "🏠" },
  { href: "/catat", label: "Catat", icon: "✍️" },
  { href: "/riwayat", label: "Riwayat", icon: "🧾" },
  { href: "/whatsapp", label: "WhatsApp", icon: "💬" },
];

export default function Nav() {
  const path = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-card/95 backdrop-blur pb-[env(safe-area-inset-bottom)] sm:static sm:border-0 sm:bg-transparent sm:pb-0">
      <ul className="mx-auto flex max-w-2xl justify-around sm:justify-start sm:gap-2 sm:px-4 sm:pt-4">
        {ITEMS.map((it) => {
          const aktif = it.href === "/" ? path === "/" : path.startsWith(it.href);
          return (
            <li key={it.href} className="flex-1 sm:flex-none">
              <Link
                href={it.href}
                aria-current={aktif ? "page" : undefined}
                className={`flex min-h-14 flex-col items-center justify-center gap-0.5 px-3 text-xs font-medium sm:min-h-10 sm:flex-row sm:gap-2 sm:rounded-xl sm:text-sm ${
                  aktif ? "text-brand sm:bg-card" : "text-muted"
                }`}
              >
                <span aria-hidden className="text-lg sm:text-base">{it.icon}</span>
                {it.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
