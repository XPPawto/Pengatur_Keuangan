import fs from "node:fs";
import path from "node:path";
import type { Db } from "../db";
import { rp } from "../money";
import { addDays, wibDate } from "../time";
import { ENVELOPE_KODE, type EnvelopeKode } from "../types";
import type { HasilStruk } from "../ocr/struk";
import { logActivity, type Actor } from "../services/activity-log";
import { getCurrentPeriod } from "../services/periods";
import { recordExpense } from "../services/transactions";
import { transferBetween } from "../services/transfers";
import { createShoppingItem } from "../services/shopping";
import { enqueue } from "../services/outbox";
import { recipientsFor } from "../services/recipients";
import { AI_WORK_DIR, type AlasanGagal } from "./claude";
import { jenisGambar, MAKS_GAMBAR } from "../keamanan/gambar";
import { bangunKonteks } from "./konteks";
import { LABEL_KONDISI, LABEL_PENYEDIA, panggilAI, type Penyedia } from "./panggil";
import { SYSTEM_ASISTEN, SYSTEM_KATEGORI, SYSTEM_REVIEW, SYSTEM_STRUK } from "./prompt";
import { cariRiwayat, hapusRiwayatDanIndeks, teksIngatan } from "./ingatan";
import { AKTOR_SISTEM } from "../services/activity-log";
import { getSetting } from "../services/settings";
import { daftarMemori, RUANG_PEMILIK, terapkanOperasi, ubahMemori, type JenisMemori, type OperasiMemori } from "./memori";

const NAMA: Record<EnvelopeKode, string> = { makan: "Makan", data: "Paket data", paylater: "Paylater", kado: "Tabungan kado", darurat: "Darurat & kos" };
const AMPLOP_CATAT: EnvelopeKode[] = ["makan", "data", "darurat"];
const RIWAYAT_JAM = 6;
const RIWAYAT_PESAN = 10;

export type AksiAI =
  | { jenis: "catat"; nominal: number; amplop: EnvelopeKode; catatan: string; tanggal?: string }
  | { jenis: "pindah"; nominal: number; dari: EnvelopeKode; ke: EnvelopeKode; alasan: string }
  | { jenis: "belanja"; nama: string; jumlah: number; satuan: string; harga: number }
  | { jenis: "kata"; kata: string; amplop: EnvelopeKode }
  | { jenis: "pesan_keluarga"; isi: string };

export interface JawabanAsisten {
  ok: boolean;
  balasan: string;
  aksi: AksiAI[];
  /** memori yang barusan disimpan / dihapus */
  memori: string[];
  alasan?: AlasanGagal;
  /** penyedia yang menjawab (claude / gemini / openrouter) */
  penyedia?: string;
  /** model yang dipakai menjawab */
  model?: string;
}

// ---------------------------------------------------------------- util

/** Ambil objek JSON dari jawaban model (toleran terhadap ``` dan teks pembuka). */
export function ambilJson<T = Record<string, unknown>>(teks: string): T | null {
  const bersih = teks.replace(/```(?:json)?/gi, "").trim();
  const a = bersih.indexOf("{");
  const b = bersih.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    return JSON.parse(bersih.slice(a, b + 1)) as T;
  } catch {
    return null;
  }
}

const isKode = (v: unknown, boleh: readonly EnvelopeKode[] = ENVELOPE_KODE): v is EnvelopeKode => typeof v === "string" && (boleh as readonly string[]).includes(v);
const bulat = (v: unknown, min: number, max: number): number | null => {
  const n = typeof v === "string" ? Number(v.replace(/[^\d]/g, "")) : Number(v);
  return Number.isFinite(n) && Math.round(n) >= min && Math.round(n) <= max ? Math.round(n) : null;
};
const teks = (v: unknown, maks: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, maks) : "");

/** Pesan singkat saat AI tidak bisa dipakai. */
export function pesanAIMati(alasan: AlasanGagal | undefined, reset?: string | null): string {
  switch (alasan) {
    case "dimatikan":
      return "Asisten AI lagi dimatikan (bisa dinyalakan di website → Asisten).";
    case "belum_diatur":
      return "Asisten AI belum disambungkan ke akun Claude (atur token di website → Asisten).";
    case "kuota":
      return "Jatah pemakaian AI hari ini udah habis (bisa dinaikkan di website → Asisten). Besok nyala lagi.";
    case "limit":
      return `Asisten AI lagi istirahat: kena batas pemakaian langganan Claude. Nyala lagi otomatis${reset ? ` jam ${reset}` : " setelah batasnya reset"}.`;
    case "belum_login":
      return "Asisten AI lagi mati: token Claude ditolak. Perbarui token di website → Asisten.";
    case "tidak_ada":
      return "Asisten AI mati: Claude Code belum terpasang di server.";
    default:
      return `Asisten AI lagi gangguan (${LABEL_KONDISI[(alasan ?? "gagal") as keyof typeof LABEL_KONDISI] ?? "error"}). Coba lagi sebentar.`;
  }
}

// ---------------------------------------------------------------- validasi aksi

/** Saring & rapikan usulan model. Aksi yang tidak valid dibuang diam-diam. */
export async function validasiAksi(db: Db, mentah: unknown, now: Date): Promise<AksiAI[]> {
  if (!Array.isArray(mentah)) return [];
  const today = wibDate(now);
  const period = await getCurrentPeriod(db);
  const terkunci = new Set((await db.envelope.findMany({ where: { terkunci: true } })).map((e) => e.kode));
  const keluarga = (await recipientsFor(db, "keluarga")).length > 0;
  const out: AksiAI[] = [];
  for (const a of mentah.slice(0, 15)) {
    if (!a || typeof a !== "object") continue;
    const x = a as Record<string, unknown>;
    switch (x.jenis) {
      case "catat": {
        const nominal = bulat(x.nominal, 100, 5_000_000);
        if (!nominal || !isKode(x.amplop, AMPLOP_CATAT)) break;
        let tanggal = typeof x.tanggal === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x.tanggal) ? x.tanggal : undefined;
        if (tanggal && (tanggal > today || tanggal < addDays(today, -7) || (period && tanggal < period.tanggalMulai))) tanggal = undefined;
        if (tanggal === today) tanggal = undefined;
        out.push({ jenis: "catat", nominal, amplop: x.amplop, catatan: teks(x.catatan, 60) || "pengeluaran", tanggal });
        break;
      }
      case "pindah": {
        const nominal = bulat(x.nominal, 500, 2_000_000);
        if (!nominal || !isKode(x.dari) || !isKode(x.ke) || x.dari === x.ke || terkunci.has(x.dari)) break;
        out.push({ jenis: "pindah", nominal, dari: x.dari, ke: x.ke, alasan: teks(x.alasan, 80) || "saran asisten" });
        break;
      }
      case "belanja": {
        const nama = teks(x.nama, 40);
        const harga = bulat(x.harga, 0, 1_000_000);
        const jumlah = Number(x.jumlah);
        if (!nama || harga === null || !(jumlah > 0 && jumlah <= 100)) break;
        out.push({ jenis: "belanja", nama, jumlah: Math.round(jumlah * 100) / 100, satuan: teks(x.satuan, 15) || "pcs", harga });
        break;
      }
      case "kata": {
        const kata = teks(x.kata, 30).toLowerCase().replace(/[^a-z\s]/g, "").trim();
        if (kata.length < 2 || !isKode(x.amplop, AMPLOP_CATAT)) break;
        if (!out.some((o) => o.jenis === "kata" && o.kata === kata)) out.push({ jenis: "kata", kata, amplop: x.amplop });
        break;
      }
      case "pesan_keluarga": {
        const isi = typeof x.isi === "string" ? x.isi.trim().slice(0, 1000) : "";
        if (isi && keluarga && !out.some((o) => o.jenis === "pesan_keluarga")) out.push({ jenis: "pesan_keluarga", isi });
        break;
      }
    }
  }
  return out;
}

export function ringkasAksi(a: AksiAI): string {
  switch (a.jenis) {
    case "catat":
      return `Catat ${a.catatan} ${rp(a.nominal)} → ${NAMA[a.amplop]}${a.tanggal ? ` (tanggal ${a.tanggal})` : ""}`;
    case "pindah":
      return `Pindah ${rp(a.nominal)} ${NAMA[a.dari]} → ${NAMA[a.ke]} (${a.alasan})`;
    case "belanja":
      return `Tambah ke daftar belanja: ${a.nama} ${a.jumlah} ${a.satuan} @${rp(a.harga)}`;
    case "kata":
      return `Ingat kata "${a.kata}" = ${NAMA[a.amplop]}`;
    case "pesan_keluarga":
      return "Kirim pesan di atas ke orang tua";
  }
}

/** Daftar usulan bernomor + cara konfirmasi (format WhatsApp). */
export function teksUsulan(aksi: AksiAI[]): string {
  const baris = ["*Usulan:*", ...aksi.map((a, i) => `${i + 1}. ${ringkasAksi(a)}`), ""];
  baris.push(aksi.length > 1 ? `Balas "ok" buat jalankan semua, "ok 1 3" buat sebagian, atau "batal".` : `Balas "ok" buat jalankan, atau "batal".`);
  return baris.join("\n");
}

// ---------------------------------------------------------------- jalankan aksi

/** Jalankan aksi yang sudah disetujui pemilik. Tiap aksi berdiri sendiri: satu gagal, lainnya tetap jalan. */
export async function jalankanAksiAI(db: Db, aksi: AksiAI[], actor: Actor, now: Date): Promise<{ berhasil: string[]; gagal: string[] }> {
  const berhasil: string[] = [];
  const gagal: string[] = [];
  const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

  const catat = aksi.filter((a): a is Extract<AksiAI, { jenis: "catat" }> => a.jenis === "catat");
  if (catat.length) {
    const ids: number[] = [];
    const ok: string[] = [];
    for (const c of catat) {
      try {
        const r = await recordExpense(db, { kode: c.amplop, nominal: c.nominal, catatan: c.catatan, sumber: actor.sumber === "web" ? "web" : "wa", pesanAsli: "[asisten]", now, tanggal: c.tanggal, log: false });
        ids.push(r.id);
        ok.push(`${c.catatan} ${rp(c.nominal)}`);
        berhasil.push(ringkasAksi(c));
      } catch (e) {
        gagal.push(`${ringkasAksi(c)}: ${msg(e)}`);
      }
    }
    if (ids.length) await logActivity(db, actor, "catat", `Catat (asisten) ${ok.join(", ")}`, { undo: { t: "hapus_tx", ids }, now });
  }

  const belanja = aksi.filter((a): a is Extract<AksiAI, { jenis: "belanja" }> => a.jenis === "belanja");
  if (belanja.length) {
    const ids: number[] = [];
    for (const b of belanja) {
      try {
        ids.push((await createShoppingItem(db, { nama: b.nama, jumlah: b.jumlah, satuan: b.satuan, hargaSatuan: b.harga })).id);
        berhasil.push(ringkasAksi(b));
      } catch (e) {
        gagal.push(`${ringkasAksi(b)}: ${msg(e)}`);
      }
    }
    if (ids.length) await logActivity(db, actor, "belanja_tambah", `Tambah ${ids.length} item ke daftar belanja (asisten)`, { undo: { t: "hapus_belanja", ids }, now });
  }

  for (const a of aksi) {
    try {
      if (a.jenis === "pindah") {
        await transferBetween(db, { dari: a.dari, ke: a.ke, nominal: a.nominal, alasan: a.alasan, now, sumber: actor.sumber === "web" ? "web" : "wa", actor });
        berhasil.push(ringkasAksi(a));
      } else if (a.jenis === "kata") {
        await ajariKata(db, a.kata, a.amplop, "ai");
        berhasil.push(ringkasAksi(a));
      } else if (a.jenis === "pesan_keluarga") {
        const tujuan = await recipientsFor(db, "keluarga");
        if (!tujuan.length) throw new Error("belum ada nomor keluarga");
        for (const nomor of tujuan) await enqueue(db, { nomor, jenis: "pesan_keluarga", isi: a.isi, kunci: `pesan_keluarga:${now.getTime()}:${nomor}` }, now);
        await logActivity(db, actor, "pesan_keluarga", `Kirim pesan ke keluarga: "${a.isi.slice(0, 60)}${a.isi.length > 60 ? "…" : ""}"`, { now });
        berhasil.push("Pesan ke orang tua masuk antrean kirim");
      }
    } catch (e) {
      gagal.push(`${ringkasAksi(a)}: ${msg(e)}`);
    }
  }
  return { berhasil, gagal };
}

// ---------------------------------------------------------------- memori & kata

/**
 * Simpan satu hal ke memori pemilik (lewat mesin memori: batas karakter, duplikat, pemindai keamanan).
 * Melempar Error dengan pesan yang bisa ditampilkan kalau ditolak. Entri yang sama persis dianggap sudah beres.
 */
export async function ingat(db: Db, isi: string, sumber: "pengguna" | "asisten" = "pengguna", jenis: JenisMemori = "catatan") {
  const r = await ubahMemori(db, RUANG_PEMILIK, { aksi: "tambah", jenis, teks: isi }, sumber, new Date());
  if (r.ok) return r.entri;
  if (r.alasan === "duplikat" && r.mirip) return r.mirip;
  throw new Error(r.pesan);
}

/** Hapus satu entri memori pemilik (hanya ruang pemilik; catatan grup & anggota tidak bisa dihapus lewat sini). */
export async function lupakan(db: Db, id: number) {
  const row = await db.aiMemori.findFirst({ where: { id, ruang: RUANG_PEMILIK } });
  if (!row) return null;
  await db.aiMemori.delete({ where: { id } });
  return row;
}

export async function ajariKata(db: Db, kataMentah: string, amplop: EnvelopeKode, sumber: "pengguna" | "ai") {
  const kata = kataMentah.toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
  if (kata.length < 2 || kata.split(" ").length > 3) return null;
  return db.kataKategori.upsert({ where: { kata }, update: { envelopeKode: amplop, sumber }, create: { kata, envelopeKode: amplop, sumber } });
}

// ---------------------------------------------------------------- ngobrol

/** {lupakan:<id>} (bentuk lama) → {hapus:"<isi entri>"}; entri yang tidak ada dibuang. */
async function petakanLupakanLama(db: Db, mentah: unknown[]): Promise<unknown[]> {
  if (!mentah.some((m) => (m as Record<string, unknown>)?.lupakan !== undefined)) return mentah;
  const semua = await daftarMemori(db, RUANG_PEMILIK);
  return mentah.flatMap((m) => {
    const o = m as Record<string, unknown>;
    if (o?.lupakan === undefined) return [m];
    const e = semua.find((x) => x.id === Number(o.lupakan));
    return e ? [{ hapus: e.isi, jenis: e.jenis }] : [];
  });
}

/** Potongan obrolan lama yang relevan dengan pesan ini (di luar jendela riwayat prompt). Gagal = kosong, tidak pernah mengganggu jawaban. */
async function ingatanLama(db: Db, kanal: string, pesan: string, now: Date): Promise<string> {
  try {
    if ((await getSetting(db, "memori_ingatan_obrolan")) !== "1") return "";
    const potongan = await cariRiwayat(db, { query: pesan, lingkup: "pemilik", now, kecuali: { kanal, jam: RIWAYAT_JAM }, maks: 4 });
    return teksIngatan(potongan, now);
  } catch {
    return "";
  }
}

async function riwayat(db: Db, kanal: string, now: Date) {
  const rows = await db.aiChat.findMany({
    where: { kanal, waktu: { gte: new Date(now.getTime() - RIWAYAT_JAM * 3600_000) } },
    orderBy: { id: "desc" },
    take: RIWAYAT_PESAN,
  });
  return rows.reverse();
}

/** Ada obrolan dengan asisten dalam beberapa menit terakhir (pesan lanjutan diarahkan ke AI). */
export async function lagiNgobrol(db: Db, kanal: string, now: Date, menit = 10): Promise<boolean> {
  const n = await db.aiChat.count({ where: { kanal, peran: "asisten", waktu: { gte: new Date(now.getTime() - menit * 60_000) } } });
  return n > 0;
}

export async function hapusRiwayat(db: Db, kanal: string) {
  await hapusRiwayatDanIndeks(db, kanal);
}

/** Ubah daftar "memori" dari jawaban model jadi operasi. Bentuk lama {ingat}/{lupakan:id} tetap dikenali. */
function bacaMemoriAI(mentah: unknown): OperasiMemori[] {
  if (!Array.isArray(mentah)) return [];
  const ops: OperasiMemori[] = [];
  const jenisDari = (v: unknown): JenisMemori | undefined => (v === "profil" || v === "catatan" ? v : undefined);
  for (const m of mentah.slice(0, 5) as Record<string, unknown>[]) {
    const jenis = jenisDari(m?.jenis);
    if (typeof m?.tambah === "string") ops.push({ aksi: "tambah", jenis: jenis ?? "catatan", teks: m.tambah });
    else if (typeof m?.ingat === "string") ops.push({ aksi: "tambah", jenis: jenis ?? "catatan", teks: m.ingat });
    else if (m?.ganti && typeof m.ganti === "object") {
      const g = m.ganti as Record<string, unknown>;
      if (typeof g.lama === "string" && typeof g.teks === "string") ops.push({ aksi: "ganti", lama: g.lama, teks: g.teks, ...(jenis ? { jenis } : {}) });
    } else if (typeof m?.hapus === "string") ops.push({ aksi: "hapus", lama: m.hapus, ...(jenis ? { jenis } : {}) });
  }
  return ops;
}

/**
 * Ngobrol dengan asisten. `kanal` = nomor WA atau "web" (riwayat terpisah).
 * Memori langsung diterapkan; aksi lain dikembalikan sebagai usulan yang perlu disetujui.
 */
export async function tanyaAsisten(db: Db, p: { kanal: string; pesan: string; now: Date; penyedia?: Penyedia; model?: string }): Promise<JawabanAsisten> {
  const pesan = p.pesan.trim().slice(0, 2000);
  const [konteks, lalu, lama] = await Promise.all([bangunKonteks(db, p.now), riwayat(db, p.kanal, p.now), ingatanLama(db, p.kanal, pesan, p.now)]);
  const prompt = [
    "<DATA>",
    konteks,
    "</DATA>",
    "",
    lama ? `${lama}\n` : "",
    lalu.length ? ["# Percakapan sebelumnya", ...lalu.map((r) => `${r.peran === "user" ? "Pemilik" : "Asisten"}: ${r.isi}`), ""].join("\n") : "",
    "# Pesan baru dari pemilik",
    pesan,
  ].join("\n");

  // penyedia/model dipilih eksplisit: hanya itu yang dicoba (tanpa pindah ke cadangan), penahanan setelah gagal diabaikan
  const h = await panggilAI(db, { fitur: p.kanal === "web" ? "chat_web" : "chat_wa", system: SYSTEM_ASISTEN, prompt, now: p.now, timeoutMs: 120_000, penyedia: p.penyedia, model: p.model, paksa: p.penyedia ? true : undefined });
  if (!h.ok) {
    const balasan = p.penyedia
      ? `*${LABEL_PENYEDIA[p.penyedia]} nggak bisa dipakai:* ${h.pesan}\nPilih penyedia lain, atau tulis tanpa kode penyedia supaya otomatis (Claude dulu, cadangan kalau Claude nggak bisa).`
      : pesanAIMati(h.alasan);
    return { ok: false, balasan, aksi: [], memori: [], alasan: h.alasan, penyedia: p.penyedia };
  }

  const j = ambilJson<{ balasan?: unknown; aksi?: unknown; memori?: unknown }>(h.teks);
  const balasan = (typeof j?.balasan === "string" ? j.balasan : j ? "" : h.teks).trim() || "Oke.";
  const aksi = j ? await validasiAksi(db, j.aksi, p.now) : [];

  const memori: string[] = [];
  if (j && Array.isArray(j.memori)) {
    try {
      // bentuk lama {lupakan:<id>} dipetakan ke potongan teks entri itu supaya lewat jalur yang sama
      const ops = bacaMemoriAI(await petakanLupakanLama(db, j.memori));
      const r = await terapkanOperasi(db, RUANG_PEMILIK, ops, "asisten", p.now, AKTOR_SISTEM);
      memori.push(...r.pesan);
      // yang penuh / tidak aman dilaporkan; duplikat & salah sasaran diam saja (bukan hal yang perlu diributkan)
      for (const d of r.ditolak) if (d.alasan === "penuh" || d.alasan === "tidak_aman") memori.push(`Tidak disimpan: ${d.pesan}`);
    } catch {
      /* memori tidak valid: abaikan, jawaban tetap dikirim */
    }
  }

  await db.aiChat.createMany({
    data: [
      { kanal: p.kanal, peran: "user", isi: pesan, waktu: p.now },
      { kanal: p.kanal, peran: "asisten", isi: aksi.length ? `${balasan}\n${aksi.map((a, i) => `[usulan ${i + 1}] ${ringkasAksi(a)}`).join("\n")}` : balasan, waktu: new Date(p.now.getTime() + 1) },
    ],
  });
  return { ok: true, balasan, aksi, memori, penyedia: h.penyedia, model: h.model };
}

// ---------------------------------------------------------------- foto

export type HasilFotoAI =
  | { jenis: "struk"; hasil: HasilStruk; kode: EnvelopeKode; kodeItem: EnvelopeKode[]; tanggal: string | null }
  | { jenis: "bukti_transfer"; nominal: number; pengirim: string | null; keterangan: string }
  | { jenis: "lain"; keterangan: string };

/** Baca foto (struk / bukti transfer) dengan Claude. null = AI tidak tersedia / gagal (pakai OCR lokal). */
export async function bacaFotoAI(db: Db, gambar: Buffer, now: Date): Promise<{ hasil: HasilFotoAI | null; alasan?: AlasanGagal }> {
  const dir = AI_WORK_DIR();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const ext = jenisGambar(gambar);
  if (!ext || gambar.length > MAKS_GAMBAR) return { hasil: null, alasan: "gagal" };
  // folder kerja unik per foto: Claude hanya diizinkan membaca isi folder ini
  const kerja = fs.mkdtempSync(path.join(dir, "foto-"));
  const nama = `foto.${ext}`;
  const file = path.join(kerja, nama);
  fs.writeFileSync(file, gambar, { mode: 0o600 });
  try {
    const h = await panggilAI(db, {
      fitur: "struk",
      system: SYSTEM_STRUK,
      prompt: `Buka dan baca file gambar ./${nama} di folder kerja saat ini. Tanggal hari ini ${wibDate(now)}.`,
      gambar: file,
      now,
      timeoutMs: 120_000,
    });
    if (!h.ok) return { hasil: null, alasan: h.alasan };
    const j = ambilJson<Record<string, unknown>>(h.teks);
    if (!j) return { hasil: null, alasan: "gagal" };
    const keterangan = teks(j.keterangan, 200);
    if (j.jenis === "bukti_transfer") {
      const nominal = bulat(j.nominal, 1000, 50_000_000);
      if (nominal) return { hasil: { jenis: "bukti_transfer", nominal, pengirim: teks(j.pengirim, 40) || null, keterangan } };
    }
    if (j.jenis === "struk") {
      const items = (Array.isArray(j.items) ? j.items : [])
        .map((i: Record<string, unknown>) => ({ nama: teks(i?.nama, 40).toLowerCase(), harga: bulat(i?.harga, 1, 10_000_000), amplop: isKode(i?.amplop, AMPLOP_CATAT) ? i.amplop : ("makan" as EnvelopeKode) }))
        .filter((i): i is { nama: string; harga: number; amplop: EnvelopeKode } => !!i.nama && i.harga !== null)
        .slice(0, 40);
      const totalBaris = bulat(j.total, 1, 10_000_000);
      const total = totalBaris ?? (items.length ? items.reduce((s, i) => s + i.harga, 0) : null);
      if (total) {
        const hitung = (k: EnvelopeKode) => items.filter((i) => i.amplop === k).reduce((s, i) => s + i.harga, 0);
        const kode = [...AMPLOP_CATAT].sort((a, b) => hitung(b) - hitung(a))[0];
        const tanggal = typeof j.tanggal === "string" && /^\d{4}-\d{2}-\d{2}$/.test(j.tanggal) ? j.tanggal : null;
        return {
          hasil: {
            jenis: "struk",
            hasil: { toko: teks(j.toko, 40) || null, items: items.map((i) => ({ nama: i.nama, harga: i.harga })), total, sumberTotal: totalBaris ? "baris_total" : "jumlah_item" },
            kode: items.length ? kode : "makan",
            kodeItem: items.map((i) => i.amplop),
            tanggal,
          },
        };
      }
    }
    return { hasil: { jenis: "lain", keterangan: keterangan || "Foto ini bukan struk atau bukti transfer." } };
  } finally {
    fs.rmSync(kerja, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- kategori

/** Tebak amplop untuk barang yang belum dikenal (model ringan). */
export async function tebakKategoriAI(db: Db, nama: string, now: Date): Promise<{ kode: EnvelopeKode; kata: string } | null> {
  const h = await panggilAI(db, { fitur: "kategori", system: SYSTEM_KATEGORI, prompt: `Barang: ${nama.slice(0, 80)}`, ringan: true, now, timeoutMs: 45_000 });
  if (!h.ok) return null;
  const j = ambilJson<{ amplop?: unknown; kata?: unknown; yakin?: unknown }>(h.teks);
  if (!j || !isKode(j.amplop, AMPLOP_CATAT) || j.yakin === false) return null;
  const kata = teks(j.kata, 30).toLowerCase().replace(/[^a-z\s]/g, "").trim();
  return { kode: j.amplop, kata: kata || nama.toLowerCase() };
}

// ---------------------------------------------------------------- review mingguan

/** Paragraf evaluasi + tantangan untuk rekap Sabtu. null kalau AI tidak tersedia. */
export async function reviewMingguanAI(db: Db, now: Date): Promise<string | null> {
  const konteks = await bangunKonteks(db, now);
  const h = await panggilAI(db, { fitur: "review", system: SYSTEM_REVIEW, prompt: `<DATA>\n${konteks}\n</DATA>\n\nTulis evaluasi minggu ini.`, now, timeoutMs: 120_000 });
  if (!h.ok) return null;
  const isi = h.teks.trim();
  return isi && !isi.startsWith("{") ? isi.slice(0, 1500) : null;
}
