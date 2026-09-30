import type { IconName } from "./icons";

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  deskripsi?: string;
}

export const NAV_GROUPS: { judul: string; items: NavItem[] }[] = [
  {
    judul: "Harian",
    items: [
      { href: "/", label: "Beranda", icon: "home", deskripsi: "Jatah makan, amplop, tagihan terdekat" },
      { href: "/catat", label: "Catat", icon: "plus-circle", deskripsi: "Catat pengeluaran cepat" },
      { href: "/riwayat", label: "Riwayat", icon: "receipt", deskripsi: "Semua transaksi per periode" },
    ],
  },
  {
    judul: "Keuangan",
    items: [
      { href: "/amplop", label: "Amplop & anggaran", icon: "wallet", deskripsi: "Alokasi, pindah antar amplop, kunci" },
      { href: "/tagihan", label: "Tagihan", icon: "calendar", deskripsi: "Paylater dan tagihan lain" },
      { href: "/target", label: "Target", icon: "target", deskripsi: "Tabungan kado & proyeksi" },
    ],
  },
  {
    judul: "Kebiasaan",
    items: [
      { href: "/belanja", label: "Belanja mingguan", icon: "cart", deskripsi: "Daftar belanja, menu, lauk rotasi" },
      { href: "/rekap", label: "Rekap", icon: "chart", deskripsi: "Grafik mingguan & tahan belanja" },
    ],
  },
  {
    judul: "Sistem",
    items: [
      { href: "/whatsapp", label: "Koneksi WhatsApp", icon: "message", deskripsi: "Pairing QR / kode, status bot" },
      { href: "/pengaturan", label: "Pengaturan", icon: "settings", deskripsi: "Nomor, pengingat, ekspor, backup" },
    ],
  },
];

export const BOTTOM_NAV: NavItem[] = [
  { href: "/", label: "Beranda", icon: "home" },
  { href: "/riwayat", label: "Riwayat", icon: "receipt" },
  { href: "/catat", label: "Catat", icon: "plus" },
  { href: "/rekap", label: "Rekap", icon: "chart" },
  { href: "/menu", label: "Lainnya", icon: "grid" },
];

export function isActive(path: string, href: string) {
  return href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);
}
