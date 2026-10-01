import type { Db } from "../db";
import { logActivity, type Actor, type SnapMemori } from "../services/activity-log";
import { getSettingNumber } from "../services/settings";
import { token } from "./ingatan";

/**
 * Memori terkurasi asisten, mengikuti desain Hermes Agent:
 * - dua jenis: PROFIL (tentang pengguna) dan CATATAN (pelajaran, kebiasaan, konvensi yang diamati asisten)
 * - batas karakter ketat per jenis; kalau penuh, penulisan DITOLAK (tidak ada yang dibuang diam-diam) supaya dirapikan dulu
 * - dikelola lewat tambah / ganti / hapus, entri dicari dengan potongan teks (substring) yang unik
 * - duplikat ditolak, isi dipindai (injeksi prompt, kredensial, karakter tak terlihat) sebelum diterima
 * Perbedaan dari Hermes: memori tidak "dibekukan" per sesi (itu demi prefix cache model; di sini tiap panggilan adalah
 * proses CLI baru tanpa cache), jadi perubahan langsung dipakai pada pesan berikutnya.
 */

export type JenisMemori = "profil" | "catatan";
export const JENIS_MEMORI: readonly JenisMemori[] = ["profil", "catatan"];
export const LABEL_JENIS: Record<JenisMemori, string> = { profil: "Profil", catatan: "Catatan" };

export const RUANG_PEMILIK = "pemilik";
export const ruangGrup = (jid: string) => `grup:${jid}`;
export const ruangAnggota = (jid: string, nomor: string) => `anggota:${jid}:${nomor}`;

/** Satu entri maksimal sekian karakter (supaya satu fakta = satu kalimat padat). */
export const MAKS_KARAKTER_ENTRI = 280;
const MAKS_ENTRI_PER_JENIS = 60;

export type SumberMemori = "pengguna" | "asisten" | "anggota";

/** Batas karakter total untuk satu jenis di satu ruang. Ruang selain pemilik lebih kecil. */
export async function batasMemori(db: Db, ruang: string, jenis: JenisMemori): Promise<number> {
  if (ruang === RUANG_PEMILIK) return (await getSettingNumber(db, jenis === "profil" ? "memori_batas_profil" : "memori_batas_catatan")) || (jenis === "profil" ? 1400 : 2200);
  if (ruang.startsWith("grup:")) return jenis === "catatan" ? 1200 : 0; // catatan bersama grup; profil per anggota ada di ruang anggota
  return jenis === "profil" ? 800 : 0; // anggota:<jid>:<nomor> = profil pribadi anggota
}

// ---------------------------------------------------------------- keamanan

const KARAKTER_TAK_TERLIHAT = /[​-‏‪-‮⁠-⁤⁦-⁩﻿­]/;
const POLA_INJEKSI: RegExp[] = [
  /abaikan\s+(semua\s+)?(instruksi|perintah|aturan|arahan)/i,
  /lupakan\s+(semua\s+)?(instruksi|aturan|perintah)/i,
  /ignore\s+(all\s+|any\s+)?(previous|prior|above|earlier)\s+(instructions?|rules?|prompts?)/i,
  /disregard\s+(the\s+)?(above|previous|system|prior)/i,
  /\b(system|developer)\s*prompt\b/i,
  /\byou\s+are\s+now\b/i,
  /<\/?\s*(system|memori|data|instruksi|assistant|user)\b/i,
  /\b(kirim|bocorkan|tampilkan|ungkap|reveal|print|show)\b.{0,40}\b(prompt|instruksi sistem|kata sandi|password|token|api[ -]?key)\b/i,
];
const POLA_RAHASIA: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}/,
  /\bAIza[0-9A-Za-z_-]{20,}/,
  /\bgsk_[A-Za-z0-9]{20,}/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/,
  /\bBearer\s+[A-Za-z0-9._-]{20,}/i,
  /(?:password|passwd|kata\s*sandi|pin|otp|cvv|cvc)\s*(?:adalah|=|:)\s*\S{3,}/i,
  /(?:\d[ -]?){15,19}/, // nomor kartu / NIK
];
const POLA_KONTAK: RegExp[] = [/[\w.+-]+@[\w-]+\.[\w.]+/, /(?:\+?62|\b0)8\d{8,11}\b/]; // surel & nomor HP: tidak disimpan di ruang grup / anggota

/** Alasan penolakan kalau isi tidak aman disimpan; null kalau aman. */
export function pindaiKeamanan(teks: string, ruang: string = RUANG_PEMILIK): string | null {
  if (KARAKTER_TAK_TERLIHAT.test(teks)) return "mengandung karakter tak terlihat";
  if (POLA_INJEKSI.some((r) => r.test(teks))) return "terlihat seperti perintah untuk mengubah perilaku asisten, bukan fakta";
  if (POLA_RAHASIA.some((r) => r.test(teks))) return "mengandung kata sandi / kunci / nomor kartu (rahasia tidak disimpan di memori)";
  if (ruang !== RUANG_PEMILIK && POLA_KONTAK.some((r) => r.test(teks))) return "mengandung surel / nomor HP (tidak disimpan di memori grup)";
  return null;
}

// ---------------------------------------------------------------- operasi

export interface EntriMemori {
  id: number;
  ruang: string;
  jenis: JenisMemori;
  isi: string;
  sumber: string;
  dibuatPada: Date;
  diperbarui: Date;
}

export type OperasiMemori =
  | { aksi: "tambah"; jenis: JenisMemori; teks: string }
  | { aksi: "ganti"; lama: string; teks: string; jenis?: JenisMemori; /** menunjuk entri langsung (dari website); mengabaikan `lama` */ id?: number }
  | { aksi: "hapus"; lama: string; jenis?: JenisMemori; id?: number };

export type AlasanTolak = "kosong" | "terlalu_panjang" | "duplikat" | "mirip" | "tidak_aman" | "penuh" | "tidak_ketemu" | "ambigu" | "jenis_tidak_ada" | "banyak_entri";

export type HasilUbah =
  | { ok: true; aksi: OperasiMemori["aksi"]; entri: EntriMemori; sebelum?: EntriMemori }
  | { ok: false; alasan: AlasanTolak; pesan: string; pakai?: number; batas?: number; mirip?: EntriMemori };

const baris = (r: { id: number; ruang: string; jenis: string; isi: string; sumber: string; dibuatPada: Date; diperbarui: Date }): EntriMemori => ({ ...r, jenis: r.jenis as JenisMemori });

/** Rapikan satu entri: satu baris, spasi tunggal. */
export function rapikanEntri(teks: string): string {
  return teks.replace(/\s+/g, " ").trim();
}

const sama = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
/** Kemiripan kata kunci (Jaccard) untuk mendeteksi entri yang hampir sama. */
function kemiripan(a: string, b: string): number {
  const x = new Set(token(a));
  const y = new Set(token(b));
  if (!x.size || !y.size) return 0;
  let irisan = 0;
  for (const k of x) if (y.has(k)) irisan++;
  return irisan / (x.size + y.size - irisan);
}

export async function daftarMemori(db: Db, ruang: string, jenis?: JenisMemori): Promise<EntriMemori[]> {
  const rows = await db.aiMemori.findMany({ where: { ruang, ...(jenis ? { jenis } : {}) }, orderBy: { id: "asc" } });
  return rows.map(baris);
}

export interface PemakaianMemori {
  jenis: JenisMemori;
  pakai: number;
  batas: number;
  jumlah: number;
}

export async function pemakaianMemori(db: Db, ruang: string): Promise<PemakaianMemori[]> {
  const semua = await daftarMemori(db, ruang);
  return Promise.all(
    JENIS_MEMORI.map(async (jenis) => {
      const e = semua.filter((x) => x.jenis === jenis);
      return { jenis, pakai: e.reduce((n, x) => n + x.isi.length, 0), batas: await batasMemori(db, ruang, jenis), jumlah: e.length };
    }),
  );
}

/** Cari satu entri lewat potongan teks. Kalau jenis tidak disebut, cari di kedua jenis. */
function cariEntri(semua: EntriMemori[], lama: string, jenis?: JenisMemori, id?: number): { ok: true; entri: EntriMemori } | { ok: false; alasan: "tidak_ketemu" | "ambigu"; pesan: string } {
  if (id !== undefined) {
    const e = semua.find((x) => x.id === id);
    return e ? { ok: true, entri: e } : { ok: false, alasan: "tidak_ketemu", pesan: "Entri itu sudah tidak ada." };
  }
  const kunci = rapikanEntri(lama).toLowerCase();
  if (!kunci) return { ok: false, alasan: "tidak_ketemu", pesan: "Potongan teks yang dicari kosong." };
  const calon = semua.filter((e) => (!jenis || e.jenis === jenis) && e.isi.toLowerCase().includes(kunci));
  if (calon.length === 0) return { ok: false, alasan: "tidak_ketemu", pesan: `Tidak ada entri yang memuat "${lama.slice(0, 60)}".` };
  if (calon.length > 1) return { ok: false, alasan: "ambigu", pesan: `${calon.length} entri memuat "${lama.slice(0, 60)}"; pakai potongan yang lebih spesifik.` };
  return { ok: true, entri: calon[0] };
}

/**
 * Terapkan satu operasi pada satu ruang. Tidak pernah membuang entri lain diam-diam: kalau tidak muat, hasilnya `penuh`
 * (beserta pemakaian dan batas) supaya pemanggil merapikan dulu.
 */
export async function ubahMemori(db: Db, ruang: string, op: OperasiMemori, sumber: SumberMemori, now: Date): Promise<HasilUbah> {
  const semua = await daftarMemori(db, ruang);

  if (op.aksi === "hapus") {
    const c = cariEntri(semua, op.lama, op.jenis, op.id);
    if (!c.ok) return c;
    await db.aiMemori.delete({ where: { id: c.entri.id } });
    return { ok: true, aksi: "hapus", entri: c.entri, sebelum: c.entri };
  }

  const teks = rapikanEntri(op.teks);
  if (!teks) return { ok: false, alasan: "kosong", pesan: "Isi memori kosong." };
  if (teks.length > MAKS_KARAKTER_ENTRI) return { ok: false, alasan: "terlalu_panjang", pesan: `Satu entri maksimal ${MAKS_KARAKTER_ENTRI} karakter (ini ${teks.length}). Ringkas jadi satu fakta padat.` };
  const bahaya = pindaiKeamanan(teks, ruang);
  if (bahaya) return { ok: false, alasan: "tidak_aman", pesan: `Ditolak: ${bahaya}.` };

  let lama: EntriMemori | undefined;
  let jenis: JenisMemori;
  if (op.aksi === "ganti") {
    const c = cariEntri(semua, op.lama, op.jenis, op.id);
    if (!c.ok) return c;
    lama = c.entri;
    jenis = op.jenis ?? c.entri.jenis;
  } else {
    jenis = op.jenis;
  }

  const batas = await batasMemori(db, ruang, jenis);
  if (batas <= 0) return { ok: false, alasan: "jenis_tidak_ada", pesan: `Ruang ini tidak menyimpan memori ${LABEL_JENIS[jenis]}.` };

  const lainnya = semua.filter((e) => e.jenis === jenis && e.id !== lama?.id);
  const persis = lainnya.find((e) => sama(e.isi, teks));
  if (persis) return { ok: false, alasan: "duplikat", pesan: "Sudah ada entri yang sama persis.", mirip: persis };
  const mirip = lainnya.find((e) => kemiripan(e.isi, teks) >= 0.8);
  if (mirip) return { ok: false, alasan: "mirip", pesan: `Hampir sama dengan entri yang sudah ada ("${mirip.isi.slice(0, 80)}"). Pakai "ganti" untuk memperbaruinya.`, mirip };
  if (!lama && lainnya.length >= MAKS_ENTRI_PER_JENIS) return { ok: false, alasan: "banyak_entri", pesan: `Maksimal ${MAKS_ENTRI_PER_JENIS} entri per jenis. Gabungkan atau hapus yang usang.` };

  const pakai = lainnya.reduce((n, e) => n + e.isi.length, 0);
  if (pakai + teks.length > batas) {
    return { ok: false, alasan: "penuh", pesan: `Memori ${LABEL_JENIS[jenis]} penuh (${pakai}/${batas} karakter, entri baru ${teks.length}). Gabungkan atau hapus entri yang usang dulu.`, pakai, batas };
  }

  if (lama) {
    const baru = await db.aiMemori.update({ where: { id: lama.id }, data: { isi: teks, jenis, diperbarui: now } });
    return { ok: true, aksi: "ganti", entri: baris(baru), sebelum: lama };
  }
  const dibuat = await db.aiMemori.create({ data: { ruang, jenis, isi: teks, sumber, dibuatPada: now, diperbarui: now } });
  return { ok: true, aksi: "tambah", entri: baris(dibuat) };
}

// ---------------------------------------------------------------- prompt

/**
 * Blok memori untuk prompt. Isinya DATA, bukan perintah (instruksi terpisah di prompt sistem menegaskan itu).
 * `judul` memberi nama ruangnya ("pemilik", "grup ini", "anggota ini").
 */
export async function teksMemori(db: Db, ruang: string, judul = "pemilik"): Promise<string> {
  const [semua, pakai] = await Promise.all([daftarMemori(db, ruang), pemakaianMemori(db, ruang)]);
  if (!semua.length) return "";
  const out: string[] = [];
  for (const j of JENIS_MEMORI) {
    const e = semua.filter((x) => x.jenis === j);
    if (!e.length) continue;
    const p = pakai.find((x) => x.jenis === j)!;
    out.push(`## ${LABEL_JENIS[j]} ${judul} [${p.pakai}/${p.batas} karakter]`, ...e.map((x) => `- [${x.id}] ${x.isi}`));
  }
  return out.join("\n");
}

// ---------------------------------------------------------------- banyak operasi sekaligus (dari AI) + catatan undo

const snap = (e: EntriMemori): SnapMemori => ({ id: e.id, ruang: e.ruang, jenis: e.jenis, isi: e.isi, sumber: e.sumber, dibuatPada: e.dibuatPada.toISOString(), diperbarui: e.diperbarui.toISOString() });
const potong = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);

export interface Ditolak {
  op: OperasiMemori;
  alasan: AlasanTolak;
  pesan: string;
}

export interface HasilTerapkan {
  /** satu baris per perubahan yang berhasil: "Diingat: …", "Diperbarui: …", "Dilupakan: …" */
  pesan: string[];
  ditolak: Ditolak[];
  /** id log aktivitas (kalau dicatat) supaya perubahan ini bisa dibatalkan */
  logId: number | null;
}

/** Catat perubahan memori ke log aktivitas dengan cara membatalkannya. Mengembalikan id log, atau null kalau tidak ada perubahan. */
async function catatPerubahan(db: Db, aktor: Actor, ruang: string, perubahan: { tambah: EntriMemori[]; sebelum: EntriMemori[]; ringkas: string[] }, now: Date): Promise<number | null> {
  const hapus = new Set(perubahan.tambah.map((e) => e.id));
  const pulih = new Map<number, EntriMemori>();
  for (const e of perubahan.sebelum) if (!pulih.has(e.id) && !hapus.has(e.id)) pulih.set(e.id, e);
  if (!hapus.size && !pulih.size) return null;
  const log = await logActivity(db, aktor, "memori", potong(`Memori: ${perubahan.ringkas.join("; ")}`, 160), { now, data: { ruang }, undo: { t: "memori", hapus: [...hapus], pulihkan: [...pulih.values()].map(snap) } });
  return log.id;
}

/**
 * Terapkan beberapa operasi berurutan pada satu ruang. Yang ditolak dikembalikan apa adanya (pemanggil memutuskan
 * mau diapakan: dilaporkan, atau memicu perapian kalau penuh). Kalau `aktor` diisi, perubahannya dicatat di log
 * aktivitas dan bisa dibatalkan.
 */
export async function terapkanOperasi(db: Db, ruang: string, ops: OperasiMemori[], sumber: SumberMemori, now: Date, aktor: Actor | null = null): Promise<HasilTerapkan> {
  const pesan: string[] = [];
  const ditolak: Ditolak[] = [];
  const perubahan = { tambah: [] as EntriMemori[], sebelum: [] as EntriMemori[], ringkas: [] as string[] };
  for (const op of ops) {
    const r = await ubahMemori(db, ruang, op, sumber, now);
    if (!r.ok) {
      ditolak.push({ op, alasan: r.alasan, pesan: r.pesan });
      continue;
    }
    if (r.aksi === "tambah") {
      perubahan.tambah.push(r.entri);
      pesan.push(`Diingat: ${r.entri.isi}`);
      perubahan.ringkas.push(`ingat "${potong(r.entri.isi, 50)}"`);
    } else if (r.aksi === "ganti") {
      if (r.sebelum) perubahan.sebelum.push(r.sebelum);
      pesan.push(`Diperbarui: ${r.entri.isi}`);
      perubahan.ringkas.push(`perbarui "${potong(r.entri.isi, 50)}"`);
    } else {
      if (r.sebelum) perubahan.sebelum.push(r.sebelum);
      pesan.push(`Dilupakan: ${r.entri.isi}`);
      perubahan.ringkas.push(`lupakan "${potong(r.entri.isi, 50)}"`);
    }
  }
  const logId = aktor ? await catatPerubahan(db, aktor, ruang, perubahan, now) : null;
  return { pesan, ditolak, logId };
}

export type HasilRapikan = { ok: true; sebelum: number; sesudah: number; karakter: number } | { ok: false; pesan: string };

/**
 * Ganti SELURUH isi satu jenis dengan daftar baru (hasil penggabungan / peringkasan oleh AI). Semua entri baru divalidasi
 * dulu (panjang, keamanan, duplikat, batas total) dan baru ditulis kalau semuanya lolos; yang isinya tidak berubah dibiarkan.
 * Pembuangan entri lama bisa dibatalkan lewat log aktivitas.
 */
export async function rapikanMemori(db: Db, ruang: string, jenis: JenisMemori, daftar: string[], sumber: SumberMemori, now: Date, aktor: Actor | null = null): Promise<HasilRapikan> {
  const batas = await batasMemori(db, ruang, jenis);
  if (batas <= 0) return { ok: false, pesan: `Ruang ini tidak menyimpan memori ${LABEL_JENIS[jenis]}.` };
  const baru: string[] = [];
  for (const mentah of daftar) {
    const t = rapikanEntri(String(mentah));
    if (!t) continue;
    if (t.length > MAKS_KARAKTER_ENTRI) return { ok: false, pesan: `Entri terlalu panjang (${t.length} > ${MAKS_KARAKTER_ENTRI}).` };
    const bahaya = pindaiKeamanan(t, ruang);
    if (bahaya) return { ok: false, pesan: `Entri ditolak: ${bahaya}.` };
    if (baru.some((x) => sama(x, t))) continue; // duplikat dibuang
    baru.push(t);
  }
  if (baru.length > MAKS_ENTRI_PER_JENIS) return { ok: false, pesan: `Maksimal ${MAKS_ENTRI_PER_JENIS} entri.` };
  const karakter = baru.reduce((n, t) => n + t.length, 0);
  if (karakter > batas) return { ok: false, pesan: `Hasil rapian masih ${karakter}/${batas} karakter.` };

  const lama = await daftarMemori(db, ruang, jenis);
  const dipertahankan = new Set<number>();
  const perlu: string[] = [];
  for (const t of baru) {
    const ada = lama.find((e) => !dipertahankan.has(e.id) && sama(e.isi, t));
    if (ada) dipertahankan.add(ada.id);
    else perlu.push(t);
  }
  const dibuang = lama.filter((e) => !dipertahankan.has(e.id));
  if (dibuang.length) await db.aiMemori.deleteMany({ where: { id: { in: dibuang.map((e) => e.id) } } });
  const dibuat: EntriMemori[] = [];
  for (const t of perlu) dibuat.push(baris(await db.aiMemori.create({ data: { ruang, jenis, isi: t, sumber, dibuatPada: now, diperbarui: now } })));
  if (aktor) await catatPerubahan(db, aktor, ruang, { tambah: dibuat, sebelum: dibuang, ringkas: [`rapikan ${LABEL_JENIS[jenis]} (${lama.length}→${baru.length} entri)`] }, now);
  return { ok: true, sebelum: lama.length, sesudah: baru.length, karakter };
}
