import { addDays, fromWib, wibDate, wibHM } from "./time";

/**
 * Aturan pesan proaktif (tidak diminta):
 * - tidak ada pesan pukul 22.00–06.00 WIB
 * - maksimal 1 pesan per jam per nomor (pesan yang jatuh bersamaan digabung jadi satu)
 * - pesan yang sudah basi (lewat batas tunda) dibuang, bukan dikirim telat
 * Pesan yang diminta sendiri (OTP, tes) selalu langsung dikirim.
 */
export const JAM_TENANG_MULAI = 22;
export const JAM_TENANG_SELESAI = 6;
export const JEDA_MENIT = 60;

/** Jenis yang diminta pengguna: bebas aturan jam tenang & jeda. */
export const DIMINTA = new Set(["otp", "tes"]);

/** Batas tunda (menit) per jenis; lewat dari ini pesan dibuang. */
const MAKS_TUNDA: Record<string, number> = {
  uang_masuk: 150,
  pagi: 180,
  malam: 55,
  tagihan: 24 * 60,
  rekap: 16 * 60,
  laporan_keluarga: 16 * 60,
  konfirmasi_uang: 16 * 60,
  tahan: 24 * 60,
  saran: 10 * 60,
  sistem: 12 * 60,
  info_kiriman: 12 * 60,
  piutang: 24 * 60,
};

export function isJamTenang(now: Date): boolean {
  const { jam } = wibHM(now);
  return jam >= JAM_TENANG_MULAI || jam < JAM_TENANG_SELESAI;
}

/** Waktu paling cepat pesan proaktif boleh dikirim (sekarang, atau 06.00 WIB berikutnya). */
export function waktuBolehKirim(now: Date): Date {
  if (!isJamTenang(now)) return now;
  const { jam } = wibHM(now);
  const tgl = jam >= JAM_TENANG_MULAI ? addDays(wibDate(now), 1) : wibDate(now);
  return fromWib(tgl, JAM_TENANG_SELESAI, 0);
}

export interface OutItem {
  id: number;
  nomor: string;
  jenis: string;
  dijadwalkan: Date;
}

export interface RencanaKirim {
  /** grup pesan per nomor yang dikirim sekarang (digabung jadi satu pesan) */
  kirim: { nomor: string; ids: number[]; proaktif: boolean }[];
  tunda: { id: number; sampai: Date }[];
  buang: number[];
}

export function rencanaKirim(items: OutItem[], terakhirProaktif: Map<string, Date>, now: Date): RencanaKirim {
  const out: RencanaKirim = { kirim: [], tunda: [], buang: [] };
  const siap = items.filter((i) => i.dijadwalkan.getTime() <= now.getTime());

  for (const i of siap.filter((x) => DIMINTA.has(x.jenis))) out.kirim.push({ nomor: i.nomor, ids: [i.id], proaktif: false });

  const perNomor = new Map<string, OutItem[]>();
  for (const i of siap.filter((x) => !DIMINTA.has(x.jenis))) perNomor.set(i.nomor, [...(perNomor.get(i.nomor) ?? []), i]);

  for (const [nomor, list] of perNomor) {
    let boleh = waktuBolehKirim(now);
    const last = terakhirProaktif.get(nomor);
    if (last && boleh.getTime() < last.getTime() + JEDA_MENIT * 60_000) boleh = new Date(last.getTime() + JEDA_MENIT * 60_000);
    if (isJamTenang(boleh)) boleh = waktuBolehKirim(boleh);

    const kirimSekarang: number[] = [];
    for (const i of list) {
      const batas = i.dijadwalkan.getTime() + (MAKS_TUNDA[i.jenis] ?? 12 * 60) * 60_000;
      if (boleh.getTime() > batas) out.buang.push(i.id);
      else if (boleh.getTime() <= now.getTime()) kirimSekarang.push(i.id);
      else out.tunda.push({ id: i.id, sampai: boleh });
    }
    if (kirimSekarang.length) out.kirim.push({ nomor, ids: kirimSekarang, proaktif: true });
  }
  return out;
}
