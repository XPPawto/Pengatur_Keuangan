import { rp } from "../money";
import { fmtRentang, fmtTanggal, namaHari } from "../time";
import type { EnvelopeBalance } from "../services/envelopes";
import type { DailyStatus } from "../services/daily";
import type { PlanResult } from "../allocation";
import type { EnvelopeKode } from "../types";

export const NAMA_PENDEK: Record<EnvelopeKode, string> = {
  makan: "Makan",
  data: "Data",
  paylater: "Paylater",
  kado: "Tabungan kado",
  darurat: "Darurat",
};

export const BANTUAN = `*DompetKos — perintah*
• \`tempe 5k\` / \`beli telur 14rb\` → catat pengeluaran (boleh banyak: \`tempe 5k sama telur 14k\`)
• \`masuk 300\` → uang mingguan masuk, mulai periode baru
• \`sisa\` → sisa semua amplop + jatah makan
• \`hari ini\` → transaksi hari ini
• \`batal\` → hapus catatan terakhir
• \`nol\` / \`gak jajan\` → tandai hari ini nggak jajan
• \`bantuan\` → pesan ini

Nominal bebas: 12k, 12rb, 12 ribu, 12.000, 12000, 1,5jt.
Fitur lain (tagihan, target, belanja, tahan belanja) nyusul di fase berikutnya.`;

export const BELUM_ADA_FITUR = "Fitur itu belum ada, nyusul di fase berikutnya. Ketik `bantuan` buat lihat yang udah jalan.";
export const TAK_PAHAM = "Gw belum ngerti maksudnya. Coba `tempe 5k`, `sisa`, atau `bantuan`.";
export const BELUM_ADA_PERIODE = "Belum ada periode aktif. Balas `masuk 300` dulu ya.";

export function ringkasAmplop(balances: EnvelopeBalance[]): string {
  return balances
    .map((b) => {
      const tag = b.terkunci ? " 🔒" : "";
      if (b.kumulatif) return `${NAMA_PENDEK[b.kode]}${tag}: ${rp(b.saldo)}`;
      return `${NAMA_PENDEK[b.kode]}: ${rp(b.saldo)} / ${rp(b.alokasi)}`;
    })
    .join("\n");
}

export function statusJatah(d: DailyStatus): string {
  if (d.hariSisa === 0) return "Periode minggu ini udah lewat. Balas `masuk <nominal>` kalau uang baru udah masuk.";
  const baris = [`Sisa makan ${rp(d.saldoMakan)} buat ${d.hariSisa} hari.`];
  if (d.makanHariIni === 0) {
    baris.push(`Jatah hari ini ${rp(d.jatahHariIni)}.`);
  } else if (d.sisaJatahHariIni >= 0) {
    baris.push(`Jatah hari ini ${rp(d.jatahHariIni)}, kepake ${rp(d.makanHariIni)}, sisa ${rp(d.sisaJatahHariIni)}. Aman.`);
  } else {
    baris.push(`Jatah hari ini ${rp(d.jatahHariIni)}, kepake ${rp(d.makanHariIni)} → lewat ${rp(-d.sisaJatahHariIni)}.`);
    if (d.hariSisa > 1) baris.push(`Jatah besok jadi ${rp(d.jatahBesok)}.`);
  }
  return baris.join("\n");
}

export function usulanPeriode(p: { tanggalMulai: string; tanggalSelesai: string; pemasukan: number }, r: PlanResult): string {
  const a = r.alloc;
  const baris = [
    `Mantap, periode ${fmtRentang(p.tanggalMulai, p.tanggalSelesai)} (uang masuk ${rp(p.pemasukan)}).`,
    `Makan ${rp(a.makan)} | Data ${rp(a.data)} | Paylater ${rp(a.paylater)}`,
    `Tabungan kado ${rp(a.kado)} | Darurat ${rp(a.darurat)}`,
  ];
  if (r.potongan.length) {
    baris.push(`Uang kurang ${rp(r.kurangAwal)} dari rencana, dipotong: ${r.potongan.map((x) => `${NAMA_PENDEK[x.kode]} -${rp(x.nominal)}`).join(", ")}.`);
    if (r.kadoBerkurang > 0) baris.push(`Dampak: target kado mundur ${rp(r.kadoBerkurang)}.`);
  }
  if (r.kurangTersisa > 0) {
    baris.push(`⚠️ Masih kurang ${rp(r.kurangTersisa)} dan Makan/Data nggak gw potong otomatis. Atur manual di website ya.`);
  }
  if (r.lebih > 0) baris.push(`Ada lebih ${rp(r.lebih)} dari rencana, gw bagi 50% kado, 50% darurat.`);
  baris.push(`Balas "ok" kalau udah dipisahin ke e-wallet tabungan. "batal" buat batalin.`);
  return baris.join("\n");
}

export function hariIniList(tanggal: string, rows: { nominal: number; catatan: string; envelope: { kode: string } }[]): string {
  const judul = `Hari ini (${namaHari(tanggal)}, ${fmtTanggal(tanggal)})`;
  if (rows.length === 0) return `${judul}: belum ada catatan.`;
  const total = rows.reduce((s, r) => s + r.nominal, 0);
  const isi = rows.map((r) => `• ${r.catatan || "(tanpa catatan)"} ${rp(r.nominal)} [${NAMA_PENDEK[r.envelope.kode as EnvelopeKode] ?? r.envelope.kode}]`);
  return [`${judul}:`, ...isi, `Total ${rp(total)}.`].join("\n");
}
