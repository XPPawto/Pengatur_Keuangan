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
      { href: "/asisten", label: "Asisten AI", icon: "bot", deskripsi: "Tanya apa aja, rencana menu, review" },
      { href: "/memori", label: "Memori AI", icon: "brain", deskripsi: "Peta memori asisten, uji ingatan, linimasa" },
    ],
  },
  {
    judul: "Keuangan",
    items: [
      { href: "/amplop", label: "Amplop & anggaran", icon: "wallet", deskripsi: "Alokasi, pindah antar amplop, kunci" },
      { href: "/tagihan", label: "Tagihan", icon: "calendar", deskripsi: "Paylater dan tagihan lain" },
      { href: "/target", label: "Target", icon: "target", deskripsi: "Tabungan kado & proyeksi" },
      { href: "/autopilot", label: "Autopilot", icon: "compass", deskripsi: "Proyeksi, simulasi \"kalau…\", saran otomatis" },
      { href: "/hutang", label: "Hutang-piutang", icon: "hand-coins", deskripsi: "Pinjaman teman kos & patungan" },
    ],
  },
  {
    judul: "Kebiasaan",
    items: [
      { href: "/belanja", label: "Belanja mingguan", icon: "cart", deskripsi: "Daftar belanja, menu, lauk rotasi" },
      { href: "/rekap", label: "Rekap", icon: "chart", deskripsi: "Grafik mingguan & tahan belanja" },
      { href: "/prestasi", label: "Prestasi", icon: "trophy", deskripsi: "Skor mingguan, tantangan, lencana, level" },
    ],
  },
  {
    judul: "Sistem",
    items: [
      { href: "/koneksi", label: "Koneksi", icon: "link", deskripsi: "Peta WhatsApp + Claude, pairing, token, pemakaian AI" },
      { href: "/aktivitas", label: "Aktivitas", icon: "undo", deskripsi: "Siapa mengubah apa, batalkan aksi" },
      { href: "/sistem", label: "Kesehatan sistem", icon: "pulse", deskripsi: "Status bot, antrean, backup, penyimpanan" },
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
